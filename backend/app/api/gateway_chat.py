from __future__ import annotations
import json, logging, uuid
from typing import AsyncGenerator

import websockets
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_org_admin
from app.core.auth import AuthContext, get_auth_context
from app.db.session import get_session
from app.schemas.gateway_api import GatewayResolveQuery
from app.services.openclaw.session_service import GatewaySessionService
from app.services.organizations import OrganizationContext

router = APIRouter(prefix="/gateways/chat", tags=["chat"])
log    = logging.getLogger(__name__)


class ChatStreamRequest(BaseModel):
    message:     str
    board_id:    str
    # ✅ format: "agent:main:mc-global-chat" per docs.acp.md
    session_key: str = "agent:main:mc-global-chat"
    agent_id:    str = "main"
    instructions: str | None = None


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

    return StreamingResponse(
        _rpc_stream(str(config.url), str(config.token), body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _rpc_stream(
    url: str, token: str, body: ChatStreamRequest
) -> AsyncGenerator[str, None]:
    try:
        async with websockets.connect(url, open_timeout=15) as ws:

            # ── Step 1: connect handshake (mandatory first frame) ─────────
            await ws.send(json.dumps({
                "type":   "connect",
                "params": {
                    "auth":   {"token": token},
                    "device": {"id": "mc-backend", "name": "Mission Control"},
                    "client": {"version": "0.1.0"},
                }
            }))
            hello = json.loads(await ws.recv())
            if hello.get("type") not in ("hello-ok", "connected", "hello"):
                raise ConnectionError(f"Handshake rejected: {hello}")

            # ── Step 2: chat.send (✅ correct method per docs.acp.md) ─────
            req_id = str(uuid.uuid4())
            await ws.send(json.dumps({
                "type":   "req",
                "id":     req_id,
                "method": "chat.send",          # ← NOT chat.message
                "params": {
                    "text":       body.message,
                    "sessionKey": body.session_key,  # ← "agent:main:mc-global-chat"
                    "stream":     True,
                }
            }))

            # ── Step 3: read streaming event frames ───────────────────────
            async for raw in ws:
                frame = json.loads(raw)
                ftype = frame.get("type")

                # Streaming agent events
                if ftype == "event":
                    payload = frame.get("payload", {})
                    delta   = (
                        payload.get("delta")
                        or payload.get("text")
                        or payload.get("content", "")
                    )
                    done    = payload.get("done") or payload.get("stop") == "complete"
                    err     = payload.get("error")

                    if err:
                        yield f"data: {json.dumps({'error': err})}\n\n"
                        return
                    if delta:
                        yield f"data: {json.dumps({'delta': delta})}\n\n"
                    if done:
                        yield "data: [DONE]\n\n"
                        return

                # Final non-streaming response fallback
                elif ftype == "res" and frame.get("id") == req_id:
                    if not frame.get("ok"):
                        yield f"data: {json.dumps({'error': frame.get('error')})}\n\n"
                        return
                    result = frame.get("payload", {})
                    text   = result.get("text") or result.get("message", "")
                    if text:
                        yield f"data: {json.dumps({'delta': text})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

    except Exception as exc:
        log.exception("Gateway chat.send stream failed")
        yield f"data: {json.dumps({'error': str(exc)})}\n\n"
