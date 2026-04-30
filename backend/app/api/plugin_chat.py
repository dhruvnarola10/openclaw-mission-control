"""Mission Control plugin-chat bridge.

Three endpoints work together to connect the browser to OpenClaw via the
mission-control-chat channel plugin:

  POST /api/v1/plugin-chat/send
      Browser sends a message.  MC validates auth + board access, then POSTs
      it to the OpenClaw gateway plugin endpoint.  Returns {requestId} so the
      browser can correlate the reply on the SSE stream.

  GET  /api/v1/plugin-chat/stream/{request_id}
      Browser opens a Server-Sent Events stream for one request/reply cycle.
      The endpoint holds open until the plugin callback delivers the reply.

  POST /api/v1/plugin-chat/reply
      Called by the OpenClaw channel plugin (authenticated with MC_PLUGIN_SHARED_SECRET).
      Delivers the agent reply into the waiting SSE stream.

Flow:
    Browser ──POST /send──► MC backend ──POST /plugins/mission-control-chat/inbound──► OpenClaw
    Browser ◄──SSE /stream/{id}──        MC backend ◄──POST /reply──                  OpenClaw
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from hmac import compare_digest
from typing import TYPE_CHECKING, Any, AsyncIterator
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.deps import require_org_admin
from app.core.auth import AuthContext, get_auth_context
from app.core.config import settings
from app.core.logging import get_logger
from app.db.session import get_session
from app.schemas.gateway_api import GatewayResolveQuery
from app.services.openclaw.session_service import GatewaySessionService
from app.services.organizations import OrganizationContext, require_board_access

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

logger = get_logger(__name__)
router = APIRouter(prefix="/plugin-chat", tags=["plugin-chat"])
SESSION_DEP = Depends(get_session)
AUTH_DEP = Depends(get_auth_context)
ORG_ADMIN_DEP = Depends(require_org_admin)

# ── In-memory reply registry ──────────────────────────────────────────────────
# Maps requestId → asyncio.Queue that receives the reply text.
# Entries are cleaned up when the SSE stream closes or after a timeout.
_pending: dict[str, asyncio.Queue[str | None]] = {}
_STREAM_TIMEOUT_S = 120


# ── Schemas ───────────────────────────────────────────────────────────────────

class PluginChatSendRequest(BaseModel):
    message: str
    board_id: str
    session_key: str | None = None
    agent_id: str | None = None
    # Optional: supply gateway coords directly (overrides board DB config)
    gateway_url: str | None = None
    gateway_token: str | None = None


class PluginChatReplyPayload(BaseModel):
    sessionKey: str
    requestId: str
    text: str
    done: bool


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_http_base(url: str) -> str:
    parsed = urlparse(url)
    scheme = "https" if parsed.scheme in ("wss", "https") else "http"
    return str(urlunparse(parsed._replace(scheme=scheme, path="", query="", fragment="")))


def _plugin_inbound_url(gateway_base: str) -> str:
    return gateway_base.rstrip("/") + "/plugins/mission-control-chat/inbound"


def _shared_secret_ok(presented: str) -> bool:
    expected = settings.mc_plugin_shared_secret
    if not expected or not presented:
        return False
    return compare_digest(presented, expected)


def _bearer_from(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return ""


# ── POST /send ────────────────────────────────────────────────────────────────

@router.post("/send")
async def plugin_chat_send(
    payload: PluginChatSendRequest,
    session: AsyncSession = SESSION_DEP,
    auth: AuthContext = AUTH_DEP,
    ctx: OrganizationContext = ORG_ADMIN_DEP,
) -> dict[str, Any]:
    """Accept a chat message from the browser, forward it to the OpenClaw plugin."""
    if auth.user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    # Resolve board + gateway config
    svc = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=payload.board_id)
    board, config, _session = await svc.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")

    await require_board_access(session, user=auth.user, board=board, write=True)

    gateway_http = _to_http_base(payload.gateway_url or config.url)
    token = payload.gateway_token or config.token
    session_key = payload.session_key or f"board:{payload.board_id}:user:{auth.user.id}"
    request_id = str(uuid.uuid4())

    inbound_body = {
        "sessionKey": session_key,
        "requestId": request_id,
        "agentId": payload.agent_id or "main",
        "boardId": payload.board_id,
        "message": payload.message,
        "timestamp": int(time.time() * 1000),
    }

    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                _plugin_inbound_url(gateway_http),
                json=inbound_body,
                headers=headers,
            )
        if resp.status_code == 202:
            logger.debug(
                "plugin_chat.send.ok board_id=%s request_id=%s", payload.board_id, request_id
            )
            return {"ok": True, "requestId": request_id, "sessionKey": session_key}

        if resp.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "OpenClaw plugin endpoint not found. "
                    "Is the mission-control-chat plugin installed and the channel account active?"
                ),
            )

        detail = resp.text[:200]
        logger.error(
            "plugin_chat.send.fail board_id=%s status=%s detail=%s",
            payload.board_id,
            resp.status_code,
            detail,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Plugin returned {resp.status_code}: {detail}",
        )

    except httpx.RequestError as exc:
        logger.error("plugin_chat.send.error board_id=%s error=%s", payload.board_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach OpenClaw gateway: {exc}",
        ) from exc


# ── GET /stream/{request_id} ──────────────────────────────────────────────────

@router.get("/stream/{request_id}")
async def plugin_chat_stream(
    request_id: str,
    auth: AuthContext = AUTH_DEP,
) -> StreamingResponse:
    """Open an SSE stream that delivers the agent reply for a given requestId."""
    if auth.user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    queue: asyncio.Queue[str | None] = asyncio.Queue()
    _pending[request_id] = queue

    async def _event_stream() -> AsyncIterator[bytes]:
        try:
            deadline = asyncio.get_event_loop().time() + _STREAM_TIMEOUT_S
            while True:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    yield b"data: [TIMEOUT]\n\n"
                    return
                try:
                    chunk: str | None = await asyncio.wait_for(
                        queue.get(), timeout=min(remaining, 25)
                    )
                except asyncio.TimeoutError:
                    # Send a keep-alive comment so the browser doesn't time out
                    yield b": ping\n\n"
                    continue

                if chunk is None:
                    yield b"data: [DONE]\n\n"
                    return

                import json as _json
                payload_bytes = _json.dumps({"text": chunk}).encode()
                yield b"data: " + payload_bytes + b"\n\n"
        finally:
            _pending.pop(request_id, None)

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── POST /reply ───────────────────────────────────────────────────────────────

@router.post("/reply", status_code=204)
async def plugin_chat_reply(
    payload: PluginChatReplyPayload,
    request: Request,
) -> None:
    """Receive the agent reply from the OpenClaw channel plugin and deliver it to the SSE stream."""
    if not _shared_secret_ok(_bearer_from(request)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")

    queue = _pending.get(payload.requestId)
    if queue is None:
        # Stream already closed or request_id unknown — log and ignore
        logger.debug("plugin_chat.reply.no_stream request_id=%s", payload.requestId)
        return

    if payload.text:
        await queue.put(payload.text)

    if payload.done:
        await queue.put(None)  # signals end-of-stream
