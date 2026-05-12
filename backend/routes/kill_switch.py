# backend/routes/kill_switch.py
"""Runtime kill-switch control routes."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from backend.services.guardian_bot.service import (
    activate_kill_switch,
    deactivate_kill_switch,
    get_guardian_status,
    is_kill_switch_active,
    kill_strategy,
    kill_venue,
    revive_strategy,
    revive_venue,
)
from backend.services.audit.service import (
    append_kill_switch_manual,
    append_kill_switch_deactivate,
)
from backend.config.loader import get_auth_config

router = APIRouter(tags=["kill-switch"])


def require_operator_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    auth = get_auth_config()
    if not auth.auth_enabled:
        return
    if not x_api_key or x_api_key != auth.api_key:
        raise HTTPException(status_code=401, detail="X-API-Key required for kill-switch control.")


class KillSwitchRequest(BaseModel):
    activate: bool
    reason: Optional[str] = None


class KillSwitchResponse(BaseModel):
    kill_switch_active: bool
    action: str
    reason: Optional[str]
    audit_id: str


class ScopedKillSwitchRequest(BaseModel):
    scope_type: Literal["strategy", "venue"]
    scope_id: str
    activate: bool
    reason: Optional[str] = None


class ScopedKillSwitchResponse(BaseModel):
    scope_type: Literal["strategy", "venue"]
    scope_id: str
    active: bool
    action: str
    reason: str


@router.post(
    "/kill-switch",
    response_model=KillSwitchResponse,
    summary="Activate or deactivate the global kill switch",
    dependencies=[Depends(require_operator_key)],
)
async def toggle_kill_switch(body: KillSwitchRequest) -> KillSwitchResponse:
    currently_active = await is_kill_switch_active()
    reason = body.reason or ("Manual operator activation" if body.activate else "Manual operator reset")

    if body.activate:
        if currently_active:
            entry = await append_kill_switch_manual(reason=f"re-activate: {reason}")
            return KillSwitchResponse(
                kill_switch_active=True,
                action="already_active",
                reason=reason,
                audit_id=entry.id,
            )
        await activate_kill_switch(reason=reason, source="operator_api")
        entry = await append_kill_switch_manual(reason=reason)
        return KillSwitchResponse(
            kill_switch_active=True,
            action="activated",
            reason=reason,
            audit_id=entry.id,
        )

    if not currently_active:
        entry = await append_kill_switch_deactivate(reason=f"already-inactive: {reason}")
        return KillSwitchResponse(
            kill_switch_active=False,
            action="already_inactive",
            reason=reason,
            audit_id=entry.id,
        )
    await deactivate_kill_switch(reason=reason)
    entry = await append_kill_switch_deactivate(reason=reason)
    return KillSwitchResponse(
        kill_switch_active=False,
        action="deactivated",
        reason=reason,
        audit_id=entry.id,
    )


@router.post(
    "/kill-switch/scope",
    response_model=ScopedKillSwitchResponse,
    summary="Activate or deactivate a strategy or venue kill switch",
    dependencies=[Depends(require_operator_key)],
)
async def toggle_scoped_kill_switch(body: ScopedKillSwitchRequest) -> ScopedKillSwitchResponse:
    reason = body.reason or (
        f"Manual operator {'activation' if body.activate else 'reset'} for {body.scope_type} {body.scope_id}"
    )

    if body.scope_type == "strategy":
        if body.activate:
            await kill_strategy(body.scope_id, reason=reason)
            action = "activated"
        else:
            await revive_strategy(body.scope_id, reason=reason)
            action = "deactivated"
    else:
        if body.activate:
            await kill_venue(body.scope_id, reason=reason)
            action = "activated"
        else:
            await revive_venue(body.scope_id, reason=reason)
            action = "deactivated"

    return ScopedKillSwitchResponse(
        scope_type=body.scope_type,
        scope_id=body.scope_id.strip().lower(),
        active=body.activate,
        action=action,
        reason=reason,
    )


@router.get(
    "/guardian/status",
    summary="Guardian and kill-switch runtime status",
)
async def get_guardian_status_route() -> dict:
    status = await get_guardian_status()
    return {
        "kill_switch_active": status.kill_switch_active,
        "triggered": status.triggered,
        "kill_switch_reason": status.kill_switch_reason,
        "trigger_reason": status.trigger_reason,
        "drawdown_pct": status.drawdown_pct,
        "api_error_count": status.api_error_count,
        "failed_order_count": status.failed_order_count,
        "thresholds": {
            "max_drawdown_pct": status.thresholds.max_drawdown_pct,
            "max_api_errors": status.thresholds.max_api_errors,
            "max_failed_orders": status.thresholds.max_failed_orders,
            "reconciliation_drift_tolerance_cycles": status.thresholds.reconciliation_drift_tolerance_cycles,
        },
        "market_data": status.market_data,
        "last_heartbeat_at": status.last_heartbeat_at,
        "heartbeat_healthy": status.heartbeat_healthy,
        "reconciliation_drift_count": status.reconciliation_drift_count,
        "reconciliation_drift_active": status.reconciliation_drift_active,
        "reconciliation_drift_reason": status.reconciliation_drift_reason,
        "strategy_kill_switches": list(status.strategy_kill_switches),
        "venue_kill_switches": list(status.venue_kill_switches),
        "computed_at": status.computed_at,
    }
