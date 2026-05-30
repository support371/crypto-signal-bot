# backend/services/guardian_bot/monitor.py
"""
Guardian Monitor — background loop bridging Portfolio → Guardian.

Every MONITOR_INTERVAL seconds:
  1. Read equity/peak from portfolio (cash-only, no live price call)
  2. Compute drawdown → feed update_drawdown() → auto kill-switch if breached
  3. Compute today's realized loss → feed update_daily_loss()
  4. Record heartbeat
"""
from __future__ import annotations

import asyncio
import logging
import time

log = logging.getLogger(__name__)

MONITOR_INTERVAL = 30  # seconds


async def _monitor_loop() -> None:
    from backend.services.guardian_bot.service import (
        update_drawdown, update_daily_loss, record_heartbeat,
    )
    import backend.services.portfolio.service as port_svc

    log.info("[guardian_monitor] started (interval=%ds)", MONITOR_INTERVAL)
    while True:
        await asyncio.sleep(MONITOR_INTERVAL)
        try:
            cash  = port_svc._cash
            peak  = port_svc._peak_equity
            dd    = float((peak - cash) / peak * 100) if float(peak) > 0 else 0.0

            now       = int(time.time())
            day_start = now - (now % 86400)
            daily_loss_pct = abs(min(
                sum(float(t.realized_pnl)
                    for t in port_svc._trades
                    if t.realized_pnl is not None and t.executed_at >= day_start),
                0.0,
            )) / float(port_svc.STARTING_CASH) * 100

            await update_drawdown(dd)
            await update_daily_loss(daily_loss_pct)
            record_heartbeat()

            log.debug("[guardian_monitor] dd=%.2f%% daily_loss=%.2f%%", dd, daily_loss_pct)
        except Exception as exc:
            log.warning("[guardian_monitor] error: %s", exc)


def start_guardian_monitor(app) -> None:
    @app.on_event("startup")
    async def _start():
        asyncio.create_task(_monitor_loop())
