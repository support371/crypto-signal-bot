# backend/routes/kill_switch.py
"""
PHASE 10 — Kill-switch route.

POST /kill-switch
  - Activates or deactivates the kill switch
  - Requires X-API-Key (operator write)
  - Audit logs every activation with actor, reason, timestamp
  - Publishes WebSocket kill_switch event
  - Guardian can also activate via backend/services/guardian_bot/service.py

The kill switch in this route is NOT cosmetic:
  - On activate: writes KILL_SWITCH:active = "1" to Redis (via guardian service)
  - The coordinator (Phase 9) checks Redis before every order
  - WebSocket broadcaster publishes kill_switch event to all connected clients

Protected files: none accessed here.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from backend.services.guardian_bot.service import (
    activate_kill_switch,
    deactivate_kill_switch,
    get_guardian_status,
    is_kill_switch_active,
)
from backend.services.audit.service import (
    append_kill_switch_manual,
    append_kill_switch_deactivate,
)
from backend.config.loader import get_auth_config

router = APIRouter(tags=["kill-switch"])


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def require_operator_key(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    auth = get_auth_config()
    if not auth.auth_enabled:
        return
    if not x_api_key or x_api_key != auth.api_key:
        raise HTTPException(status_code=401, detail="X-API-Key required for kill-switch control.")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class KillSwitchRequest(BaseModel):
    activate: bool
    reason:   Optional[str] = None


class KillSwitchResponse(BaseModel):
    kill_switch_active: bool
    action:             str   # "activated" | "deactivated" | "already_active" | "already_inactive"
    reason:             Optional[str]
    audit_id:           str


# ---------------------------------------------------------------------------
# POST /kill-switch
# ---------------------------------------------------------------------------

@router.post(
    "/kill-switch",
    response_model=KillSwitchResponse,
    summary="Activate or deactivate the kill switch",
    description=(
        "Activates or deactivates the runtime kill switch. "
        "When active: all execution is blocked at the coordinator level. "
        "Every activation and deactivation is audited. "
        "This route changes real runtime behavior — not a UI-only action."
    ),
    dependencies=[Depends(require_operator_key)],
)
async def toggle_kill_switch(body: KillSwitchRequest) -> KillSwitchResponse:
    currently_active = await is_kill_switch_active()
    reason = body.reason or ("Manual operator activation" if body.activate else "Manual operator reset")

    if body.activate:
        if currently_active:
            # Idempotent — re-activating is logged but harmless
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

    else:  # deactivate
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


# ---------------------------------------------------------------------------
# GET /guardian/status — normalized with kill switch state
# ---------------------------------------------------------------------------

@router.get(
    "/guardian/status",
    summary="Guardian and kill-switch runtime status",
)
async def get_guardian_status_route() -> dict:
    status = await get_guardian_status()
    return {
        "kill_switch_active":   status.kill_switch_active,
        "triggered":            status.triggered,
        "kill_switch_reason":   status.kill_switch_reason,
        "trigger_reason":       status.trigger_reason,
        "drawdown_pct":         status.drawdown_pct,
        "api_error_count":      status.api_error_count,
        "failed_order_count":   status.failed_order_count,
        "thresholds": {
            "max_drawdown_pct":  status.thresholds.max_drawdown_pct,
            "max_api_errors":    status.thresholds.max_api_errors,
            "max_failed_orders": status.thresholds.max_failed_orders,
        },
        "market_data":          status.market_data,
        "last_heartbeat_at":    status.last_heartbeat_at,
        "heartbeat_healthy":    status.heartbeat_healthy,
        "computed_at":          status.computed_at,
    }
