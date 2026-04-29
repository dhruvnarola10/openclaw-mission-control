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
from app.services.openclaw.gateway_rpc import openclaw_call, get_chat_history
from app.services.organizations import OrganizationContext

router = APIRouter(prefix="/gateways/chat", tags=["chat"])
log = logging.getLogger(__name__)

class ChatStreamRequest(BaseModel):
    board_id: str
    message: str
    session_key: str = "agent:main:mc-global-chat"

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
        _stream(str(config.url), str(config.token), body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

async def _stream(url, token, body) -> AsyncGenerator[str, None]:
    try:
        async with websockets.connect(url, open_timeout=25) as ws:
            await ws.send(json.dumps({
                "type": "connect",
                "params": {"auth": {"token": token}, "device": {"id": "mc-backend"}, "client": {"version": "0.1.0"}}
            }))
            hello = json.loads(await ws.recv())
            if hello.get("type") not in ("hello-ok", "connected", "hello"):
                yield f"data: {json.dumps({'error': 'Handshake failed'})}\n\n"; return

            req_id = str(uuid.uuid4())
            await ws.send(json.dumps({
                "type": "req", "id": req_id,
                "method": "chat.send",
                "params": {"text": body.message, "sessionKey": body.session_key, "stream": True}
            }))
            async for raw in ws:
                frame = json.loads(raw)
                if frame.get("type") == "event":
                    p = frame.get("payload", {})
                    delta = p.get("delta") or p.get("text") or p.get("content", "")
                    if p.get("error"):
                        yield f"data: {json.dumps({'error': p['error']})}\n\n"; return
                    if delta:
                        yield f"data: {json.dumps({'delta': delta})}\n\n"
                    if p.get("done"):
                        yield "data: [DONE]\n\n"; return
                elif frame.get("type") == "res" and frame.get("id") == req_id:
                    content = frame.get("result", {}).get("text") or frame.get("result", {}).get("content", "")
                    if content:
                        yield f"data: {json.dumps({'delta': content})}\n\n"
                    yield "data: [DONE]\n\n"; return
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

@router.get("/sessions")
async def list_sessions(
    board_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=board_id)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not config:
        raise HTTPException(404, "Gateway not found")
    res = await openclaw_call("sessions.list", config=config)
    return {"sessions": res} if isinstance(res, list) else res

@router.get("/slash-commands")
async def list_slash_commands(
    board_id: str,
    session: AsyncSession = Depends(get_session),
    auth: AuthContext = Depends(get_auth_context),
    ctx: OrganizationContext = Depends(require_org_admin),
):
    service = GatewaySessionService(session)
    params = GatewayResolveQuery(board_id=board_id)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not config:
        raise HTTPException(404, "Gateway not found")
    res = await openclaw_call("commands.list", {"scope": "text", "includeArgs": True}, config=config)
    return res.get("commands", []) if isinstance(res, dict) else res

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
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    if not config:
        raise HTTPException(404, "Gateway not found")
    res = await get_chat_history(session_key, config=config, limit=50)
    return {"history": res} if isinstance(res, list) else res
