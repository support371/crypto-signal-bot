# backend/routes/monitor_v1.py
"""
Phase 5b — Monitoring endpoints.

GET  /api/v1/monitor/status   — Current probe results + overall health
GET  /api/v1/monitor/probes   — List of registered probe names
POST /api/v1/monitor/run      — Trigger an immediate probe run (operator only)
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException

from backend.config.loader import get_auth_config
from backend.services.monitoring.service import (
    get_monitor_status,
    _run_probes,
    _process_results,
)
from backend.services.monitoring.probes import (
    ALL_PROBES,
    probe_cooldown,
    probe_external_liveness,
)
from backend.services.monitoring.service import REALERT_INTERVAL

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/monitor", tags=["monitoring"])


def _require_operator(
    x_api_key: Optional[str] = Header(default=None, alias="X-API-Key"),
) -> None:
    auth = get_auth_config()
    if not auth.auth_enabled:
        return
    if not x_api_key or x_api_key != auth.api_key:
        raise HTTPException(status_code=401, detail="X-API-Key required.")


@router.get("/status", summary="Current monitoring probe results")
async def monitor_status() -> dict:
    """
    Returns the latest result for every registered health probe,
    plus an overall ok/failing flag.
    """
    status = get_monitor_status()
    status["realert_interval"] = REALERT_INTERVAL
    return status


@router.get("/probes", summary="List registered probe names")
async def list_probes() -> dict:
    names = [fn.__name__.replace("probe_", "") for fn in ALL_PROBES]
    return {"probes": names, "count": len(names)}


@router.post("/run", summary="Trigger an immediate probe run",
             dependencies=[Depends(_require_operator)])
async def run_probes_now() -> dict:
    """
    Force an out-of-cycle probe run.  Results are stored in the monitoring
    state and returned in the response.  Useful for post-deploy validation
    or on-demand dashboard refresh.
    """
    try:
        results = await _run_probes()
        await _process_results(results)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {
        "ran":     len(results),
        "results": [
            {
                "name":       r.name,
                "ok":         r.ok,
                "latency_ms": r.latency_ms,
                "error":      r.error,
                "detail":     r.detail,
                "ts":         r.ts,
            }
            for r in results
        ],
    }


# ---------------------------------------------------------------------------
# Phase 8 — Ingestion pipeline monitoring endpoints
# ---------------------------------------------------------------------------

@router.get("/ingestion", summary="Real-time ingestion pipeline telemetry")
async def ingestion_telemetry() -> dict:
    """
    Per-symbol ingestion metrics:
      - last_fetch_at       unix timestamp of last successful candle fetch
      - age_seconds         seconds since last successful fetch
      - last_fetch_latency_ms  round-trip time of most recent adapter call
      - fetch_count         total successful fetches since startup
      - error_count         total failed fetches since startup
      - candle_count        current ring buffer depth
      - stale               True if age > FRESHNESS_WARN_THRESHOLD

    Also returns the pipeline-level summary: running status, avg latency,
    stale symbols, and configuration (poll interval, buffer size).
    """
    try:
        from backend.services.market_data.ingestion import (
            get_ingestion_metrics,
            get_pipeline_status,
        )
        return {
            "pipeline":  get_pipeline_status(),
            "symbols":   get_ingestion_metrics(),
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Ingestion pipeline unavailable: {exc}")


@router.get("/ingestion/{symbol}", summary="Ingestion metrics for a single symbol")
async def ingestion_symbol_telemetry(symbol: str) -> dict:
    """
    Focused view for one symbol — useful when debugging a specific feed.
    Returns 404 if the symbol is not actively tracked.
    """
    try:
        from backend.services.market_data.ingestion import get_ingestion_metrics
        metrics = get_ingestion_metrics()
        sym = symbol.upper()
        if sym not in metrics:
            raise HTTPException(status_code=404, detail=f"{sym} not tracked by ingestion pipeline")
        return {"symbol": sym, **metrics[sym]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@router.post("/ingestion/symbols", summary="Hot-reconfigure tracked symbol list",
             dependencies=[Depends(_require_operator)])
async def reconfigure_symbols(body: dict) -> dict:
    """
    Body: {"symbols": ["BTCUSDT", "ETHUSDT", ...]}

    Hot-reconfigures the ingestion pipeline without restart:
      - New symbols get fresh ring buffers immediately.
      - Removed symbols are evicted from memory.
      - Existing symbol buffers are preserved.

    Operator-only endpoint (requires X-Operator-Key header on non-paper deployments).
    """
    symbols = body.get("symbols", [])
    if not isinstance(symbols, list) or not symbols:
        raise HTTPException(status_code=400, detail="'symbols' must be a non-empty list")

    symbols = [str(s).upper() for s in symbols]

    try:
        from backend.services.market_data.ingestion import pipeline
        pipeline.set_active_symbols(symbols)
        return {"ok": True, "active_symbols": sorted(pipeline._active)}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
