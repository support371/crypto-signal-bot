"""Audit trail and decision trace endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from backend.logic import rate_limit
from backend.audit.store import get_audit, get_trace_by_intent_id, get_traces

router = APIRouter(dependencies=[Depends(rate_limit.rate_limit)])


@router.get("/audit")
def get_audit_trail():
    return get_audit()


@router.get("/traces")
def get_traces_list(
    symbol: Optional[str] = Query(None, description="Filter by symbol"),
    status: Optional[str] = Query(None, description="Filter by execution status"),
    limit: int = Query(50, ge=1, le=500, description="Max traces to return"),
):
    return get_traces(symbol=symbol, status=status, limit=limit)


@router.get("/trace/{intent_id}")
def get_trace_by_intent(intent_id: str):
    trace = get_trace_by_intent_id(intent_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Trace not found")
    return trace


@router.get("/metrics")
def get_metrics():
    try:
        from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
        return JSONResponse(
            content=generate_latest().decode("utf-8"),
            media_type=CONTENT_TYPE_LATEST,
        )
    except ImportError:
        return {"message": "prometheus_client not installed"}
