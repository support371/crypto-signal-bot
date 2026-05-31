# backend/services/signal_executor/service.py
"""
Signal Executor — bridges the signal engine to the paper portfolio.

Every EXECUTOR_INTERVAL seconds the loop:
  1. Reads all cached signals from the signal service.
  2. For each symbol, compares the new signal against the last-acted-on
     signal (direction + strategy_id).
  3. If the signal has changed AND confidence >= MIN_CONFIDENCE:
       - Closes any existing opposite position (MARKET order).
       - Opens a new position sized by POSITION_PCT of current equity.
  4. If the signal returns to FLAT, close any open position.

Design decisions
----------------
- MIN_CONFIDENCE  = 0.60  (operator-overridable via env EXECUTOR_MIN_CONFIDENCE)
- POSITION_PCT    = 0.05  (5% of equity per symbol)
- MAX_POSITIONS   = 4     (hard cap on simultaneous open positions)
- Only MARKET orders — clean fills at live CoinGecko price.
- Guardian kill-switch respected: submit_order propagates the block.
- Idempotent: same signal on consecutive ticks -> no order.
- Equity-adaptive sizing: notional recalculated each sweep.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Dict

log = logging.getLogger(__name__)

EXECUTOR_INTERVAL: int   = 65
MIN_CONFIDENCE:    float = float(os.getenv("EXECUTOR_MIN_CONFIDENCE", "0.60"))
POSITION_PCT:      float = float(os.getenv("EXECUTOR_POSITION_PCT",   "0.05"))
MAX_POSITIONS:     int   = int(os.getenv("EXECUTOR_MAX_POSITIONS",    "4"))

_last_acted: Dict[str, tuple] = {}   # symbol -> (side, strategy_id)
_running:    bool = False
_run_count:  int  = 0
_last_run_at: int = 0


def get_executor_status() -> dict:
    return {
        "running":           _running,
        "run_count":         _run_count,
        "last_run_at":       _last_run_at,
        "executor_interval": EXECUTOR_INTERVAL,
        "min_confidence":    MIN_CONFIDENCE,
        "position_pct":      POSITION_PCT,
        "max_positions":     MAX_POSITIONS,
        "last_acted":        {s: {"side": v[0], "strategy_id": v[1]}
                              for s, v in _last_acted.items()},
    }


async def _get_equity() -> float:
    try:
        from backend.services.portfolio.service import get_portfolio_summary
        summary = await get_portfolio_summary()
        return float(summary.get("equity", 10000.0))
    except Exception:
        return 10000.0


async def _get_open_positions() -> list:
    """Return list of open positions [{symbol, qty}]."""
    try:
        from backend.services.portfolio.service import get_portfolio_summary
        summary = await get_portfolio_summary()
        return summary.get("open_positions", [])
    except Exception:
        return []


async def _get_open_qty(symbol: str) -> float:
    positions = await _get_open_positions()
    for p in positions:
        if p.get("symbol", "").upper() == symbol.upper():
            return float(p.get("qty", 0.0))
    return 0.0


async def _count_open_positions() -> int:
    """Count symbols with an open position."""
    positions = await _get_open_positions()
    return sum(1 for p in positions if float(p.get("qty", 0.0)) > 0)


async def _close_position(symbol: str, qty: float) -> None:
    if qty <= 0:
        return
    try:
        from backend.services.portfolio.service import submit_order
        order = await submit_order(
            symbol=symbol, side="SELL",
            order_type="MARKET", qty=qty,
        )
        log.info("[executor] CLOSE %s qty=%.6f -> order=%s status=%s",
                 symbol, qty, order.id[:8], order.status)
    except Exception as exc:
        log.warning("[executor] close failed %s: %s", symbol, exc)


async def _open_position(symbol: str, side: str, equity: float) -> None:
    try:
        from backend.services.market_data.service import get_price
        snap = await get_price(symbol)
        price = float(snap.price)
        if price <= 0:
            return
    except Exception as exc:
        log.warning("[executor] price unavailable for %s: %s", symbol, exc)
        return

    notional = equity * POSITION_PCT
    if notional < 10.0:
        return
    qty = notional / price

    try:
        from backend.services.portfolio.service import submit_order
        order = await submit_order(
            symbol=symbol, side=side,
            order_type="MARKET", qty=qty,
        )
        log.info(
            "[executor] OPEN %s %s qty=%.6f notional=%.2f @ %.4f -> order=%s status=%s",
            side, symbol, qty, notional, price, order.id[:8], order.status,
        )
    except Exception as exc:
        log.warning("[executor] open failed %s %s: %s", side, symbol, exc)


async def _execute_symbol(symbol: str, signal, open_count: int = 0) -> int:
    """Execute signal for one symbol. Returns updated open_count."""
    new_side       = getattr(signal, "side", "FLAT")
    new_strategy   = getattr(signal, "strategy_id", "")
    new_confidence = float(getattr(signal, "confidence", 0.0))
    new_key        = (new_side, new_strategy)
    prev_key       = _last_acted.get(symbol, ("FLAT", ""))
    prev_side      = prev_key[0]

    if new_side != "FLAT" and new_confidence < MIN_CONFIDENCE:
        return open_count

    if new_key == prev_key:
        return open_count

    log.info("[executor] signal change %s: %s->%s conf=%.3f strat=%s",
             symbol, prev_side, new_side, new_confidence, new_strategy)

    equity = await _get_equity()

    # Close existing position first
    closed = False
    if prev_side in ("BUY", "SELL"):
        qty = await _get_open_qty(symbol)
        if qty > 0:
            await _close_position(symbol, qty)
            open_count -= 1
            closed = True

    # Open new directional position — respect MAX_POSITIONS cap
    if new_side in ("BUY", "SELL"):
        if open_count < MAX_POSITIONS:
            await _open_position(symbol, new_side, equity)
            open_count += 1
        else:
            log.info("[executor] MAX_POSITIONS cap (%d) reached — skipping new %s %s",
                     MAX_POSITIONS, new_side, symbol)
            # Still record the signal so we don't keep trying
            _last_acted[symbol] = new_key
            return open_count

    _last_acted[symbol] = new_key
    return open_count


async def _executor_loop() -> None:
    global _running, _run_count, _last_run_at
    _running = True
    log.info("[executor] started interval=%ds min_conf=%.2f position_pct=%.0f%% max_positions=%d",
             EXECUTOR_INTERVAL, MIN_CONFIDENCE, POSITION_PCT * 100, MAX_POSITIONS)

    await asyncio.sleep(30)   # let signal service warm up first

    # --- Startup self-heal ---
    # On the very first sweep, if _last_acted is pre-populated (shouldn't happen
    # in a fresh process, but can occur if the module was imported in a hot-reload
    # context) AND the portfolio is empty, wipe it so signals are evaluated fresh.
    _last_acted.clear()
    log.info("[executor] cleared last_acted on startup for clean first sweep")

    while True:
        try:
            from backend.services.signal_service.service import get_all_cached_signals
            signals = get_all_cached_signals()

            # Rolling desync check: if portfolio has zero trades + zero positions
            # but we somehow have stale last_acted, clear it mid-run.
            if _last_acted and _run_count > 0:
                try:
                    from backend.services.portfolio.service import get_portfolio_summary
                    summary = await get_portfolio_summary()
                    if summary.get("trade_count", 0) == 0 and not summary.get("open_positions"):
                        log.warning(
                            "[executor] mid-run desync: last_acted=%d but portfolio empty. "
                            "Clearing for next sweep.",
                            len(_last_acted)
                        )
                        _last_acted.clear()
                except Exception:
                    pass

            # Count currently open positions once per sweep
            open_count = await _count_open_positions()

            for sig in signals:
                symbol = getattr(sig, "symbol", None)
                if symbol:
                    open_count = await _execute_symbol(symbol, sig, open_count)

            _last_run_at = int(time.time())
            _run_count  += 1
            log.debug("[executor] sweep #%d (%d signals, %d open positions)",
                      _run_count, len(signals), open_count)
        except Exception as exc:
            log.error("[executor] loop error: %s", exc, exc_info=True)
        await asyncio.sleep(EXECUTOR_INTERVAL)


def start_signal_executor(app) -> None:
    asyncio.create_task(_executor_loop())
