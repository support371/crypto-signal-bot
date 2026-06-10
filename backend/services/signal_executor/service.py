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
- MIN_CONFIDENCE  = 0.75  (operator-overridable via env EXECUTOR_MIN_CONFIDENCE)
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

from backend.config.settings import get_settings as _get_settings
from backend.logic.decision_tracer import decision_tracer, HoldReason

log = logging.getLogger(__name__)

def _settings():
    return _get_settings()

# Read from Settings (which reads from env vars with validated defaults)
# These are evaluated at import time for performance, but settings object
# is the canonical source — do not hardcode values here.
EXECUTOR_INTERVAL: int   = int(os.getenv("EXECUTOR_INTERVAL", str(_settings().executor_interval_seconds)))
MIN_CONFIDENCE:    float = _settings().executor_min_confidence
POSITION_PCT:      float = _settings().executor_position_pct
MAX_POSITIONS:     int   = _settings().executor_max_positions

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
        from backend.services.market_data.service import get_price, MarketDataStale
        try:
            snap = await get_price(symbol)
            price = float(snap.price)
        except MarketDataStale as stale_exc:
            # CoinGecko rate-limited — use the stale cached price for paper trading.
            # A few-minute-old price is perfectly acceptable for paper order sizing.
            if stale_exc.stale_ticker and stale_exc.stale_ticker.price > 0:
                price = float(stale_exc.stale_ticker.price)
                log.info("[executor] using stale price for %s: %.4f (%s)",
                         symbol, price, stale_exc.reason)
            else:
                log.warning("[executor] stale price unavailable for %s: %s", symbol, stale_exc)
                return
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

    equity = await _get_equity()
    notional = equity * POSITION_PCT

    if new_side != "FLAT" and new_confidence < MIN_CONFIDENCE:
        # HOLD: low confidence
        entry = decision_tracer.make_entry(
            symbol=symbol, decision="HOLD", side=None,
            confidence=new_confidence, strategy_id=new_strategy,
            signal_side=new_side, equity=equity, notional=notional, mode="paper",
            hold_reasons=[HoldReason(
                code="LOW_CONFIDENCE",
                description=f"Confidence {new_confidence:.3f} below threshold {MIN_CONFIDENCE:.3f}",
                threshold=MIN_CONFIDENCE, actual=new_confidence,
            )],
        )
        decision_tracer.record(entry)
        return open_count

    if new_key == prev_key:
        # HOLD: no change in signal
        if new_side == "FLAT":
            return open_count  # silent flat — don't spam traces
        entry = decision_tracer.make_entry(
            symbol=symbol, decision="HOLD", side=None,
            confidence=new_confidence, strategy_id=new_strategy,
            signal_side=new_side, equity=equity, notional=notional, mode="paper",
            hold_reasons=[HoldReason(
                code="NO_SIGNAL_CHANGE",
                description=f"Signal unchanged: side={new_side} strategy={new_strategy}",
            )],
        )
        decision_tracer.record(entry)
        return open_count

    log.info("[executor] signal change %s: %s->%s conf=%.3f strat=%s",
             symbol, prev_side, new_side, new_confidence, new_strategy)

    # Close existing position first
    closed = False
    if prev_side in ("BUY", "SELL"):
        qty = await _get_open_qty(symbol)
        if qty > 0:
            await _close_position(symbol, qty)
            open_count -= 1
            closed = True

    # Open new directional position — respect MAX_POSITIONS cap
    # Paper mode is LONG-ONLY: BUY opens a new long; SELL only closes existing longs (above).
    # Never submit a naked SELL order with no underlying position — it will cancel immediately.
    if new_side == "BUY":
        if open_count < MAX_POSITIONS:
            await _open_position(symbol, new_side, equity)
            open_count += 1
        else:
            log.info("[executor] MAX_POSITIONS cap (%d) reached — skipping new BUY %s",
                     MAX_POSITIONS, symbol)
            entry = decision_tracer.make_entry(
                symbol=symbol, decision="HOLD", side="BUY",
                confidence=new_confidence, strategy_id=new_strategy,
                signal_side=new_side, equity=equity, notional=notional, mode="paper",
                hold_reasons=[HoldReason(
                    code="MAX_POSITIONS_REACHED",
                    description=f"Open positions ({open_count}) >= MAX_POSITIONS ({MAX_POSITIONS})",
                    threshold=float(MAX_POSITIONS), actual=float(open_count),
                )],
            )
            decision_tracer.record(entry)
            # Still record the signal so we don't keep trying
            _last_acted[symbol] = new_key
            return open_count
    elif new_side == "SELL":
        # Long-only paper mode: SELL = close long (already done above).
        # Do not attempt to open a short position.
        if not closed:
            log.debug("[executor] SELL signal for %s but no long to close — skip", symbol)

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
