# backend/services/monitoring/probes.py
"""
Health probe definitions.

Each probe is an async callable that returns a ProbeResult.
Probes are intentionally thin — they call internal service functions
or app-local endpoints (no external network) and normalise the output.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result type
# ---------------------------------------------------------------------------

@dataclass
class ProbeResult:
    name:       str
    ok:         bool
    ts:         int = field(default_factory=lambda: int(time.time()))
    latency_ms: int = 0
    detail:     Dict[str, Any] = field(default_factory=dict)
    error:      Optional[str] = None


# ---------------------------------------------------------------------------
# Individual probes
# ---------------------------------------------------------------------------

try:
    import backend.logic.context as _ctx
except Exception:
    _ctx = None  # type: ignore[assignment]


async def probe_health() -> ProbeResult:
    """Check app liveness — reads shared context state directly (no app import)."""
    t0 = time.perf_counter()
    try:
        if _ctx is None:
            raise ImportError("context module not available")
        ok = True
        detail: Dict[str, Any] = {
            "kill_switch_active": _ctx.kill_switch_active,
            "guardian_triggered": _ctx.guardian_triggered,
        }
    except Exception as exc:
        ok = False
        detail = {}
        return ProbeResult(name="health", ok=False,
                           latency_ms=0, error=str(exc))
    ms = int((time.perf_counter() - t0) * 1000)
    return ProbeResult(name="health", ok=ok, latency_ms=ms, detail=detail)


async def probe_market_data() -> ProbeResult:
    """Check live market data connectivity."""
    t0 = time.perf_counter()
    try:
        from backend.services.market_data.aggregator import get_price  # noqa: PLC0415
        snap = await get_price("BTCUSDT")
        ok = snap is not None and float(snap.price) > 0
        detail = {"price": float(snap.price) if snap else None}
    except Exception as exc:
        ok = False
        detail = {}
        return ProbeResult(name="market_data", ok=False,
                           latency_ms=int((time.perf_counter() - t0) * 1000),
                           error=str(exc))
    ms = int((time.perf_counter() - t0) * 1000)
    return ProbeResult(name="market_data", ok=ok, latency_ms=ms, detail=detail)


try:
    from backend.services.guardian_bot.service import get_guardian_status
except Exception:
    get_guardian_status = None  # type: ignore[assignment]


async def probe_guardian() -> ProbeResult:
    """Check guardian service state."""
    t0 = time.perf_counter()
    try:
        if get_guardian_status is None:
            raise ImportError("guardian service not available")
        g = await get_guardian_status()
        # Guardian is "ok" when the service is running and not triggered
        ok = not g.triggered
        detail = {
            "kill_switch_active": g.kill_switch_active,
            "triggered":         g.triggered,
            "drawdown_pct":      round(g.drawdown_pct, 3),
            "daily_loss_pct":    round(g.daily_loss_pct, 3),
            "api_error_count":   g.api_error_count,
            "failed_order_count": g.failed_order_count,
        }
    except Exception as exc:
        ok = False
        detail = {}
        return ProbeResult(name="guardian", ok=False,
                           latency_ms=int((time.perf_counter() - t0) * 1000),
                           error=str(exc))
    ms = int((time.perf_counter() - t0) * 1000)
    return ProbeResult(name="guardian", ok=ok, latency_ms=ms, detail=detail)


try:
    from backend.services.signal_service.service import (
        get_signal_service_status,
        get_all_cached_signals,
    )
except Exception:
    get_signal_service_status = None  # type: ignore[assignment]
    get_all_cached_signals = None  # type: ignore[assignment]


async def probe_signal_engine() -> ProbeResult:
    """Check signal evaluation service — at least one symbol has a cached signal."""
    t0 = time.perf_counter()
    try:
        if get_signal_service_status is None or get_all_cached_signals is None:
            raise ImportError("signal service not available")
        status = get_signal_service_status()
        signals = get_all_cached_signals()
        ok = status.get("running", False) and len(signals) > 0
        detail = {
            "running":        status.get("running"),
            "cached_symbols": status.get("cached_symbols", []),
            "cached_count":   len(signals),
        }
    except Exception as exc:
        ok = False
        detail = {}
        return ProbeResult(name="signal_engine", ok=False,
                           latency_ms=int((time.perf_counter() - t0) * 1000),
                           error=str(exc))
    ms = int((time.perf_counter() - t0) * 1000)
    return ProbeResult(name="signal_engine", ok=ok, latency_ms=ms, detail=detail)


try:
    from backend.services.exchange_retry import (  # noqa: F401
        get_all_circuit_breaker_statuses,
    )
except Exception:
    get_all_circuit_breaker_statuses = None  # type: ignore[assignment]


async def probe_circuit_breakers() -> ProbeResult:
    """Check that no exchange circuit breaker is permanently open."""
    t0 = time.perf_counter()
    try:
        if get_all_circuit_breaker_statuses is None:
            raise ImportError("exchange_retry not available")
        breakers = get_all_circuit_breaker_statuses()
        open_breakers = [b for b in breakers if b.get("state") == "open"]
        ok = len(open_breakers) == 0
        detail = {
            "total":  len(breakers),
            "open":   len(open_breakers),
            "names":  [b.get("name") for b in open_breakers],
        }
    except Exception as exc:
        # Circuit breaker service unavailable is non-fatal for the probe
        ok = True
        detail = {"error": str(exc)}
        return ProbeResult(name="circuit_breakers", ok=True,
                           latency_ms=int((time.perf_counter() - t0) * 1000),
                           detail=detail)
    ms = int((time.perf_counter() - t0) * 1000)
    return ProbeResult(name="circuit_breakers", ok=ok, latency_ms=ms, detail=detail)


try:
    from backend.services.portfolio.service import get_portfolio_summary
except Exception:
    get_portfolio_summary = None  # type: ignore[assignment]


async def probe_portfolio() -> ProbeResult:
    """Check portfolio service is accessible and returning data."""
    t0 = time.perf_counter()
    try:
        if get_portfolio_summary is None:
            raise ImportError("portfolio service not available")
        summary = await get_portfolio_summary()
        ok = summary.get("equity", 0) >= 0
        detail = {
            "equity":      summary.get("equity"),
            "cash":        summary.get("cash_balance"),
            "drawdown_pct": summary.get("drawdown_pct"),
        }
    except Exception as exc:
        ok = False
        detail = {}
        return ProbeResult(name="portfolio", ok=False,
                           latency_ms=int((time.perf_counter() - t0) * 1000),
                           error=str(exc))
    ms = int((time.perf_counter() - t0) * 1000)
    return ProbeResult(name="portfolio", ok=ok, latency_ms=ms, detail=detail)


# ---------------------------------------------------------------------------
# Probe registry — ordered by severity
# ---------------------------------------------------------------------------

ALL_PROBES = [
    probe_health,
    probe_guardian,
    probe_market_data,
    probe_circuit_breakers,
    probe_signal_engine,
    probe_portfolio,
]
