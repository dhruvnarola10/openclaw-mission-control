"""Gateway chat API — send/receive messages via the OpenClaw gateway WebSocket protocol."""
from __future__ import annotations

import json
import logging
import uuid
from typing import TYPE_CHECKING, Any, AsyncGenerator

import httpx
import websockets
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_org_admin
from app.core.auth import AuthContext, get_auth_context
from app.db.session import get_session
from app.schemas.gateway_api import GatewayResolveQuery
from app.services.openclaw.gateway_rpc import (
    GatewayConfig,
    _build_gateway_url,
    _build_control_ui_origin,
    _create_ssl_context,
    _recv_first_message_or_none,
    _ensure_connected,
    openclaw_call,
    get_chat_history,
)
from app.services.openclaw.session_service import GatewaySessionService
from app.services.organizations import OrganizationContext

router = APIRouter(prefix="/gateways/chat", tags=["chat"])
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# GET /gateways/chat/ws-config  — return gateway WS url + token for direct
#                                  browser ↔ gateway connection
# ---------------------------------------------------------------------------

@router.get("/ws-config")
async def get_ws_config(
    board_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    """Return the WebSocket URL and token so the browser can connect directly."""
    if auth.user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=board_id)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not board:
        raise HTTPException(404, "Board not found")
    if not config:
        raise HTTPException(404, "Gateway not found")

    # Convert http(s) → ws(s) so the browser WebSocket constructor accepts it
    url = str(config.url or "").strip()
    if url.startswith("http://"):
        url = "ws://" + url[7:]
    elif url.startswith("https://"):
        url = "wss://" + url[8:]

    return {"url": url, "token": config.token or ""}


class ChatStreamRequest(BaseModel):
    board_id: str
    message: str
    session_key: str = "main"


class ChatResponsesRequest(BaseModel):
    board_id: str
    message: str
    session_key: str = "main"
    agent_id: str = "main"


# ---------------------------------------------------------------------------
# POST /gateways/chat/responses  — proxy /v1/responses SSE from the gateway
# ---------------------------------------------------------------------------

@router.post("/responses")
async def chat_responses_proxy(
    body: ChatResponsesRequest,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    """Proxy POST /v1/responses to the OpenClaw gateway, streaming SSE back to the browser."""
    if auth.user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=body.board_id)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not board:
        raise HTTPException(404, "Board not found")
    if not config:
        raise HTTPException(404, "Gateway not found")

    # Normalise to http(s) base URL
    gateway_url = str(config.url or "").strip().rstrip("/")
    if gateway_url.startswith("ws://"):
        gateway_url = "http://" + gateway_url[5:]
    elif gateway_url.startswith("wss://"):
        gateway_url = "https://" + gateway_url[6:]

    return StreamingResponse(
        _proxy_responses_stream(gateway_url, config.token or "", body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _proxy_responses_stream(
    gateway_base: str,
    token: str,
    body: ChatResponsesRequest,
) -> AsyncGenerator[bytes, None]:
    headers: dict[str, str] = {
        "Content-Type": "application/json",
        "x-openclaw-agent-id": body.agent_id,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    payload = {
        "model": "openclaw",
        "stream": True,
        "input": body.message,
        "user": body.session_key,
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{gateway_base}/v1/responses",
                json=payload,
                headers=headers,
            ) as resp:
                if not resp.is_success:
                    err_text = await resp.aread()
                    yield f"data: {json.dumps({'error': f'Gateway {resp.status_code}: {err_text.decode()}'})}\n\n".encode()
                    return
                async for chunk in resp.aiter_bytes():
                    if chunk:
                        yield chunk
    except Exception as exc:
        log.exception("chat_responses_proxy error")
        yield f"data: {json.dumps({'error': str(exc)})}\n\n".encode()


# ---------------------------------------------------------------------------
# POST /gateways/chat/stream  — send a message, stream back tokens
# ---------------------------------------------------------------------------

@router.post("/stream")
async def chat_stream(
    body: ChatStreamRequest,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    if auth.user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=body.board_id)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not board:
        raise HTTPException(404, "Board not found")
    if not config:
        raise HTTPException(404, "Gateway not found")

    # config is already GatewayConfig (alias GatewayClientConfig)
    return StreamingResponse(
        _stream_chat(config, body.message, body.session_key),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream_chat(
    config: GatewayConfig,
    message: str,
    session_key: str,
) -> AsyncGenerator[str, None]:
    """
    Connect to the OpenClaw gateway using the exact same handshake protocol
    used by the rest of the backend (challenge-response via _ensure_connected),
    send chat.send, then stream back chat events as SSE.

    OpenClaw emits WebSocket frames of type "event" with event="chat" and a
    payload.state of "delta" / "final" / "aborted" / "error".
    """
    gateway_url = _build_gateway_url(config)

    origin = _build_control_ui_origin(gateway_url) if config.disable_device_pairing else None
    ssl_context = _create_ssl_context(config)

    connect_kwargs: dict[str, Any] = {"ping_interval": None, "open_timeout": 30}
    if origin is not None:
        connect_kwargs["origin"] = origin
    if ssl_context is not None:
        connect_kwargs["ssl"] = ssl_context

    try:
        async with websockets.connect(gateway_url, **connect_kwargs) as ws:
            # ── Step 1: proper OpenClaw challenge-response handshake ──────────
            first_msg = await _recv_first_message_or_none(ws)
            await _ensure_connected(ws, first_msg, config)

            # ── Step 2: send chat.send with correct schema ────────────────────
            req_id = str(uuid.uuid4())
            await ws.send(json.dumps({
                "type": "req",
                "id": req_id,
                "method": "chat.send",
                "params": {
                    "sessionKey": session_key,
                    "message": message,
                    "idempotencyKey": str(uuid.uuid4()),
                },
            }))

            # ── Step 3: receive frames until the chat run completes ───────────
            async for raw in ws:
                frame = json.loads(raw)
                ftype = frame.get("type")

                # Acknowledgment from our chat.send request
                if ftype == "res" and frame.get("id") == req_id:
                    if not frame.get("ok", True):
                        err = frame.get("error", {})
                        msg = err.get("message") if isinstance(err, dict) else str(err)
                        yield f"data: {json.dumps({'error': msg or 'Gateway error'})}\n\n"
                        return
                    continue

                # Streaming chat event from the gateway
                if ftype == "event" and frame.get("event") == "chat":
                    payload = frame.get("payload") or {}
                    # Only handle events for our session
                    ev_session = payload.get("sessionKey", "")
                    if ev_session and ev_session != session_key:
                        continue

                    state = payload.get("state")
                    msg_obj = payload.get("message")

                    if state == "delta":
                        text = _extract_text(msg_obj)
                        if text:
                            yield f"data: {json.dumps({'delta': text})}\n\n"

                    elif state == "final":
                        text = _extract_text(msg_obj)
                        if text:
                            yield f"data: {json.dumps({'delta': text})}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    elif state == "aborted":
                        text = _extract_text(msg_obj) or ""
                        if text:
                            yield f"data: {json.dumps({'delta': text})}\n\n"
                        yield "data: [DONE]\n\n"
                        return

                    elif state == "error":
                        yield f"data: {json.dumps({'error': payload.get('errorMessage', 'Chat error')})}\n\n"
                        return

    except Exception as exc:
        log.exception("gateway_chat._stream_chat error")
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"


def _extract_text(msg_obj: object) -> str:
    """Extract plain text from an OpenClaw gateway chat message object."""
    if msg_obj is None:
        return ""
    if isinstance(msg_obj, str):
        return msg_obj
    if not isinstance(msg_obj, dict):
        return ""

    # Direct text field (common in delta events)
    text = msg_obj.get("text")
    if isinstance(text, str) and text:
        return text

    # Structured content array (used in final messages)
    content = msg_obj.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text" and b.get("text")
        ]
        return "\n\n".join(parts)

    return ""


# ---------------------------------------------------------------------------
# GET /gateways/chat/sessions
# ---------------------------------------------------------------------------

@router.get("/sessions")
async def list_sessions(
    board_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=board_id)
    _board, config, _main = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not config:
        raise HTTPException(404, "Gateway not found")
    res = await openclaw_call("sessions.list", config=config)
    return {"sessions": res} if isinstance(res, list) else res


# ---------------------------------------------------------------------------
# GET /gateways/chat/slash-commands
# ---------------------------------------------------------------------------

@router.get("/slash-commands")
async def list_slash_commands(
    board_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=board_id)
    _board, config, _main = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not config:
        raise HTTPException(404, "Gateway not found")
    res = await openclaw_call(
        "commands.list", {"scope": "text", "includeArgs": True}, config=config
    )
    return res.get("commands", []) if isinstance(res, dict) else res


# ---------------------------------------------------------------------------
# GET /gateways/chat/sessions/{session_key}/history
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_key}/history")
async def get_history(
    session_key: str,
    board_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=board_id)
    _board, config, _main = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not config:
        raise HTTPException(404, "Gateway not found")

    res = await get_chat_history(session_key, config=config, limit=50)

    # Normalize to the format frontend expects: {messages: [{id, role, content}]}
    raw_list: list[Any] = []
    if isinstance(res, list):
        raw_list = res
    elif isinstance(res, dict):
        raw_list = res.get("messages") or []

    messages = []
    for msg in raw_list:
        if not isinstance(msg, dict):
            continue
        role = msg.get("role", "assistant")
        if role not in ("user", "assistant"):
            continue
        text = _extract_text(msg)
        if not text:
            continue
        messages.append({
            "id": str(msg.get("id") or uuid.uuid4()),
            "role": role,
            "content": text,
        })

    return {"messages": messages}
