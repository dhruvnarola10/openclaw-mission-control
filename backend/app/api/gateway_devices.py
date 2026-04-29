"""Gateway device pairing API wrappers."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends

from app.api.deps import require_org_admin
from app.core.auth import AuthContext, get_auth_context
from app.db.session import get_session
from app.schemas.common import OkResponse
from app.api.gateway import RESOLVE_INPUT_DEP, GatewayResolveQuery
from app.services.openclaw.session_service import GatewaySessionService
from app.services.openclaw.gateway_rpc import openclaw_call
from app.services.organizations import OrganizationContext

if TYPE_CHECKING:
    from sqlmodel.ext.asyncio.session import AsyncSession

router = APIRouter(prefix="/gateways/devices", tags=["gateways", "devices"])

SESSION_DEP = Depends(get_session)
AUTH_DEP = Depends(get_auth_context)
ORG_ADMIN_DEP = Depends(require_org_admin)


@router.get("")
async def list_devices(
    params: GatewayResolveQuery = RESOLVE_INPUT_DEP,
    session: AsyncSession = SESSION_DEP,
    auth: AuthContext = AUTH_DEP,
    ctx: OrganizationContext = ORG_ADMIN_DEP,
) -> Any:
    """List pending device pairing requests from the gateway."""
    service = GatewaySessionService(session)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    
    # Require authorization to the gateway
    service._require_same_org(board, ctx.organization.id)
    
    response = await openclaw_call("device.pair.list", config=config)
    return response


@router.post("/{request_id}/approve", response_model=OkResponse)
async def approve_device(
    request_id: str,
    params: GatewayResolveQuery = RESOLVE_INPUT_DEP,
    session: AsyncSession = SESSION_DEP,
    auth: AuthContext = AUTH_DEP,
    ctx: OrganizationContext = ORG_ADMIN_DEP,
) -> OkResponse:
    """Approve a pending device pairing request."""
    service = GatewaySessionService(session)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    
    # Require authorization to the gateway
    service._require_same_org(board, ctx.organization.id)
    
    await openclaw_call("device.pair.approve", {"requestId": request_id}, config=config)
    return OkResponse()


@router.post("/{request_id}/reject", response_model=OkResponse)
async def reject_device(
    request_id: str,
    params: GatewayResolveQuery = RESOLVE_INPUT_DEP,
    session: AsyncSession = SESSION_DEP,
    auth: AuthContext = AUTH_DEP,
    ctx: OrganizationContext = ORG_ADMIN_DEP,
) -> OkResponse:
    """Reject a pending device pairing request."""
    service = GatewaySessionService(session)
    board, config, _main_session = await service.resolve_gateway(
        params, user=auth.user, organization_id=ctx.organization.id
    )
    
    # Require authorization to the gateway
    service._require_same_org(board, ctx.organization.id)
    
    await openclaw_call("device.pair.reject", {"requestId": request_id}, config=config)
    return OkResponse()
