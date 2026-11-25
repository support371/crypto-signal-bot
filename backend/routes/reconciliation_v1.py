"""Reconciliation and exchange validation endpoints."""

from fastapi import APIRouter, Depends

from backend import app_state
from backend.logic import rate_limit

router = APIRouter(dependencies=[Depends(rate_limit.rate_limit)])


@router.get("/reconciliation/status")
async def reconciliation_status_api():
    from backend.services.reconciliation.service import get_latest_report
    report = await get_latest_report()
    if report is None:
        return {"status": "no_report", "message": "Reconciliation has not run yet."}
    return {"status": "ok", "report": report}


@router.get("/reconciliation/exchange")
def exchange_reconciliation_api():
    from backend.services.exchange_reconciler import reconcile_against_exchange
    result = reconcile_against_exchange(
        adapter=app_state.adapter(),
        local_balances=dict(app_state.portfolio().balances),
    )
    return result.to_dict()
