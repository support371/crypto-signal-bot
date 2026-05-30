# backend/services/monitoring/service.py
"""
Monitoring service — periodic health probes + alert dispatch.

Background loop runs every PROBE_INTERVAL seconds, executes all probes
in parallel, compares results against the previous run and fires alerts
when a probe transitions from ok → failing or recovers.

Consecutive failure counting:
  - Alert on first failure of a CRITICAL probe immediately
  - Alert on WARNING probe after WARN_THRESHOLD consecutive failures
    (avoids noisy transient blips)
  - Recovery alert when probe returns to ok after being failing

State is in-process (no Redis/DB dependency) so it survives config
changes but resets on restart — acceptable for monitoring.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from backend.services.monitoring.probes import ALL_PROBES, ProbeResult
from backend.services.monitoring.alerts import Severity, dispatch

log = logging.getLogger(__name__)

PROBE_INTERVAL = 60          # seconds between full probe runs
WARN_THRESHOLD = 2           # consecutive failures before WARNING alert
CRIT_THRESHOLD = 1           # consecutive failures before CRITICAL alert

# Probes that are CRITICAL (alert immediately on first failure)
CRITICAL_PROBES = {"health", "guardian"}


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

@dataclass
class ProbeState:
    last_result:          Optional[ProbeResult] = None
    consecutive_failures: int = 0
    alerted_down:         bool = False   # True if we fired a down-alert already
    last_alert_at:        int = 0


_probe_states: Dict[str, ProbeState] = {}
_last_run_at:  int = 0
_running:      bool = False
_run_count:    int = 0


def get_monitor_status() -> dict:
    """Return current snapshot for the /monitor/status endpoint."""
    probes = {}
    for name, state in _probe_states.items():
        r = state.last_result
        probes[name] = {
            "ok":                  r.ok if r else None,
            "latency_ms":          r.latency_ms if r else None,
            "consecutive_failures": state.consecutive_failures,
            "error":               r.error if r else None,
            "detail":              r.detail if r else {},
            "ts":                  r.ts if r else None,
            "alerted":             state.alerted_down,
        }
    overall_ok = all(
        (s.last_result.ok if s.last_result else True)
        for s in _probe_states.values()
    )
    return {
        "running":      _running,
        "last_run_at":  _last_run_at,
        "run_count":    _run_count,
        "probe_interval": PROBE_INTERVAL,
        "overall_ok":   overall_ok,
        "probes":       probes,
    }


# ---------------------------------------------------------------------------
# Core loop
# ---------------------------------------------------------------------------

async def _run_probes() -> List[ProbeResult]:
    """Run all probes concurrently, return results."""
    tasks = [asyncio.create_task(probe()) for probe in ALL_PROBES]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for probe_fn, res in zip(ALL_PROBES, results):
        if isinstance(res, Exception):
            name = probe_fn.__name__.replace("probe_", "")
            out.append(ProbeResult(name=name, ok=False, error=str(res)))
        else:
            out.append(res)
    return out


async def _process_results(results: List[ProbeResult]) -> None:
    """Update state and fire alerts for changed probe status."""
    for result in results:
        name = result.name
        if name not in _probe_states:
            _probe_states[name] = ProbeState()
        state = _probe_states[name]
        prev_ok = state.last_result.ok if state.last_result else True

        state.last_result = result

        if result.ok:
            # Recovery
            if state.consecutive_failures > 0 and state.alerted_down:
                await dispatch(
                    title=f"✅ Probe recovered: {name}",
                    message=f"Probe `{name}` is back to healthy after "
                            f"{state.consecutive_failures} failure(s).",
                    severity=Severity.INFO,
                    extra={"latency_ms": result.latency_ms},
                )
            state.consecutive_failures = 0
            state.alerted_down = False
        else:
            state.consecutive_failures += 1
            is_critical = name in CRITICAL_PROBES
            threshold = CRIT_THRESHOLD if is_critical else WARN_THRESHOLD

            if state.consecutive_failures >= threshold and not state.alerted_down:
                severity = Severity.CRITICAL if is_critical else Severity.WARNING
                await dispatch(
                    title=f"🚨 Probe failing: {name}",
                    message=(
                        f"Probe `{name}` has failed "
                        f"{state.consecutive_failures} consecutive time(s).\n"
                        f"Error: {result.error or 'no error detail'}"
                    ),
                    severity=severity,
                    extra={
                        "consecutive_failures": state.consecutive_failures,
                        "detail": str(result.detail)[:200],
                    },
                )
                state.alerted_down = True
                state.last_alert_at = int(time.time())

        log.debug(
            "[monitor] probe=%s ok=%s latency=%dms failures=%d",
            name, result.ok, result.latency_ms, state.consecutive_failures,
        )


async def _monitor_loop() -> None:
    global _last_run_at, _run_count, _running
    _running = True
    log.info("[monitor] started (interval=%ds)", PROBE_INTERVAL)

    # Stagger first run by 10s to let app finish startup
    await asyncio.sleep(10)

    while True:
        try:
            results = await _run_probes()
            await _process_results(results)
            _last_run_at = int(time.time())
            _run_count += 1

            ok_count   = sum(1 for r in results if r.ok)
            fail_count = len(results) - ok_count
            log.info(
                "[monitor] run #%d complete — %d/%d probes ok",
                _run_count, ok_count, len(results),
            )

            if fail_count > 0:
                failing = [r.name for r in results if not r.ok]
                log.warning("[monitor] failing probes: %s", failing)

        except Exception as exc:
            log.error("[monitor] loop error: %s", exc, exc_info=True)

        await asyncio.sleep(PROBE_INTERVAL)


def start_monitoring_service(app) -> None:
    """Register the monitoring background loop with the FastAPI app."""
    # Direct task creation — called from lifespan() which is already async
    asyncio.create_task(_monitor_loop())
