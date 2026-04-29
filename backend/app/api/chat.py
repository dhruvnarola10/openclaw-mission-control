"""Streaming chat proxy — forwards messages to the OpenClaw gateway /v1/responses SSE endpoint.

Architecture:
    Browser → POST /api/v1/chat/stream → this handler → gateway /v1/responses (SSE)

The gateway token is resolved server-side from the board's gateway config, so it
never reaches the browser.  Falls back to the existing ``chat.send`` RPC if the
gateway does not expose /v1/responses (older gateway builds).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, AsyncIterator
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.deps import require_org_admin
from app.core.auth import AuthContext, get_auth_context
from app.core.logging import get_logger
from app.db.session import get_session
from app.schemas.gateway_api import GatewayResolveQuery
from app.services.openclaw.gateway_rpc import (
    OpenClawGatewayError,
    send_message,
)
from app.services.openclaw.session_service import GatewaySessionService
from app.services.organizations import OrganizationContext, require_board_access

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

logger = get_logger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])
SESSION_DEP = Depends(get_session)
AUTH_DEP = Depends(get_auth_context)
ORG_ADMIN_DEP = Depends(require_org_admin)


class ChatStreamRequest(BaseModel):
    """Request body for the streaming chat endpoint."""

    message: str
    session_key: str
    board_id: str
    instructions: str | None = None
    agent_id: str | None = None
    # Optional overrides — frontend can supply these from env vars so the
    # backend does not need the token stored in the board DB config.
    gateway_token: str | None = None
    gateway_url: str | None = None


def _to_http_base(ws_url: str) -> str:
    """Convert a ws:// or wss:// gateway URL to its http(s):// base (no path/query)."""
    parsed = urlparse(ws_url)
    scheme = "https" if parsed.scheme == "wss" else "http"
    return str(urlunparse(parsed._replace(scheme=scheme, path="", query="", fragment="")))


async def _stream_gateway_sse(
    gateway_http: str,
    token: str | None,
    payload: dict[str, Any],
    agent_id: str | None = None,
) -> AsyncIterator[bytes]:
    """Open an SSE stream to the gateway /v1/responses and yield raw chunks."""
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    # Required by OpenClaw gateway to route to the correct agent session
    headers["x-openclaw-agent-id"] = agent_id or "main"

    url = f"{gateway_http}/v1/responses"
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            if resp.status_code == 404:
                raise FileNotFoundError("/v1/responses not available on this gateway")
            if resp.status_code >= 400:
                body = await resp.aread()
                raise httpx.HTTPStatusError(
                    f"Gateway returned {resp.status_code}: {body.decode()}",
                    request=resp.request,
                    response=resp,
                )
            async for chunk in resp.aiter_bytes():
                yield chunk


@router.post("/stream")
async def chat_stream(
    payload: ChatStreamRequest,
    session: AsyncSession = SESSION_DEP,
    auth: AuthContext = AUTH_DEP,
    ctx: OrganizationContext = ORG_ADMIN_DEP,
) -> StreamingResponse:
    """Stream an OpenClaw gateway response for a task chat message.

    Tries the gateway's OpenAI-compatible ``/v1/responses`` SSE endpoint first.
    Falls back to the existing ``chat.send`` RPC (fire-and-forget) for older
    gateways that don't expose the HTTP streaming surface.
    """
    if auth.user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)

    # ---- resolve gateway config from board ----
    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=payload.board_id)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if board is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Board not found")

    await require_board_access(session, user=auth.user, board=board, write=True)

    gateway_http = _to_http_base(payload.gateway_url or config.url)
    # Frontend-supplied token takes precedence over the board DB config token
    token = payload.gateway_token or config.token

    model = f"openclaw/{payload.agent_id}" if payload.agent_id else "openclaw"
    request_payload: dict[str, Any] = {
        "model": model,
        "input": payload.message,
        "stream": True,
        "user": payload.session_key,
    }
    if payload.instructions:
        request_payload["instructions"] = payload.instructions

    logger.debug(
        "chat.stream.start board_id=%s session_key=%s gateway=%s",
        payload.board_id,
        payload.session_key,
        gateway_http,
    )

    # ---- try SSE streaming ----
    try:
        stream_iter = _stream_gateway_sse(
            gateway_http, token, request_payload, agent_id=payload.agent_id
        )

        # Pull the first chunk to confirm the stream opened before committing to StreamingResponse
        first_chunk: bytes | None = None
        async for chunk in stream_iter:
            first_chunk = chunk
            break

        async def _with_first(first: bytes, rest: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
            yield first
            async for c in rest:
                yield c

        inner: AsyncIterator[bytes] = (
            _with_first(first_chunk, stream_iter)
            if first_chunk is not None
            else (x async for x in iter(()))  # type: ignore[assignment]
        )

        return StreamingResponse(
            inner,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    except FileNotFoundError:
        logger.info(
            "chat.stream.fallback board_id=%s — /v1/responses not available, using chat.send",
            payload.board_id,
        )

    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        logger.error("chat.stream.error board_id=%s error=%s", payload.board_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gateway streaming error: {exc}",
        ) from exc

    # ---- fallback: fire-and-forget chat.send RPC ----
    try:
        await send_message(
            payload.message,
            session_key=payload.session_key,
            config=config,
        )
    except OpenClawGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    # Return a synthetic [DONE] SSE so the client knows to stop
    async def _done() -> AsyncIterator[bytes]:
        yield b"data: [DONE]\n\n"

    return StreamingResponse(
        _done(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
