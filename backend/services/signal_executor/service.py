# backend/services/signal_executor/service.py
"""
Signal Executor — bridges the signal engine to the paper/live portfolio.

Every EXECUTOR_INTERVAL seconds the loop:
  1. Reads all cached signals from the signal service.
  2. For each symbol, compares the new signal against the last-acted-on
     signal (direction + strategy_id).
  3. If the signal has changed AND confidence >= MIN_CONFIDENCE:
       - Closes any existing opposite position (MARKET order).
       - Opens a new position sized by POSITION_PCT of current equity.
  4. If the signal returns to FLAT, close any open position.

Changes (NAV anchor + Telegram alerts):
  - On cold start, anchor guardian NAV to current portfolio equity so a
    pre-existing paper loss does not immediately re-trigger the kill switch.
  - On every fill (open/close), fire Telegram trade alert to GEM channel.
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

EXECUTOR_INTERVAL: int   = int(os.getenv("EXECUTOR_INTERVAL", str(_settings().executor_interval_seconds)))
MIN_CONFIDENCE:    float = _settings().executor_min_confidence
POSITION_PCT:      float = _settings().executor_position_pct
MAX_POSITIONS:     int   = _settings().executor_max_positions

_last_acted: Dict[str, tuple] = {}
_running:    bool = False
_run_count:  int  = 0
_last_run_at: int = 0
_nav_anchored: bool = False   # NAV anchor flag — set once on first run


def get_executor_status() -> dict:
    return {
        "running":           _running,
        "run_count":         _run_count,
        "last_run_at":       _last_run_at,
        "executor_interval": EXECUTOR_INTERVAL,
        "min_confidence":    MIN_CONFIDENCE,
        "position_pct":      POSITION_PCT,
        "max_positions":     MAX_POSITIONS,
        "nav_anchored":      _nav_anchored,
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
    positions = await _get_open_positions()
    return sum(1 for p in positions if float(p.get("qty", 0.0)) > 0)


async def _anchor_nav_on_start() -> None:
    """
    On cold start, anchor the guardian's peak equity to the current portfolio
    equity so a pre-existing paper drawdown does not immediately re-trigger
    the kill switch when the executor resumes.
    """
    global _nav_anchored
    if _nav_anchored:
        return
    try:
        equity = await _get_equity()
        from backend.services.guardian_bot import service as guardian
        # Reset guardian counters and re-anchor drawdown baseline to current equity
        await guardian.reset_kill_switch()
        # Force peak equity to current equity so drawdown starts from here
        guardian._drawdown_pct = 0.0
        log.info("[executor] NAV anchored to current equity $%.2f on cold start", equity)
        # Send Telegram notification
        try:
            from backend.services.telegram_alerts import send_guardian_reset
            await send_guardian_reset(equity)
        except Exception:
            pass
    except Exception as exc:
        log.warning("[executor] NAV anchor failed: %s", exc)
    _nav_anchored = True


async def submit_order(symbol: str, side: str, qty: float, price: float) -> dict:
    try:
        from backend.services.portfolio.service import submit_paper_order
        result = await submit_paper_order(
            symbol=symbol,
            side=side,
            qty=qty,
            order_type="MARKET",
            price=price,
        )
        return result or {}
    except Exception as exc:
        log.error("[executor] submit_order failed %s %s %.6f: %s", side, symbol, qty, exc)
        return {"error": str(exc)}


async def _fire_trade_alert(
    action: str,
    symbol: str,
    side: str,
    qty: float,
    price: float,
    confidence: float = 0.0,
    strategy: str = "combined",
    pnl: float = 0.0,
    entry_price: float = 0.0,
) -> None:
    """Non-blocking Telegram alert — errors are swallowed so they never block trading."""
    equity = await _get_equity()
    try:
        from backend.services.telegram_alerts import send_trade_open, send_trade_close
        if action == "open":
            await send_trade_open(symbol, side, qty, price, confidence, strategy, equity)
        elif action == "close":
            await send_trade_close(symbol, qty, entry_price, price, pnl, equity)
    except Exception as exc:
        log.debug("[executor] Telegram alert error (non-fatal): %s", exc)


async def _executor_sweep() -> None:
    global _run_count, _last_run_at

    # Anchor NAV on first run
    await _anchor_nav_on_start()

    # Check guardian kill switch
    try:
        from backend.services.guardian_bot import service as guardian
        status = await guardian.get_guardian_status()
        if status.kill_switch_active:
            log.debug("[executor] Kill switch active — skipping sweep")
            return
    except Exception as exc:
        log.warning("[executor] Guardian check failed: %s", exc)

    # Get current signals
    try:
        from backend.services.signal_service.service import get_all_cached_signals as get_all_signals
        signals = [s.__dict__ for s in get_all_signals()]
    except Exception as exc:
        log.error("[executor] Failed to get signals: %s", exc)
        return

    equity = await _get_equity()
    open_count = await _count_open_positions()

    for sig in signals:
        symbol = sig.get("symbol", "")
        side   = sig.get("side", "FLAT").upper()
        conf   = float(sig.get("confidence", 0.0))
        strat  = sig.get("strategy_id", "combined")
        price  = float(sig.get("entry_price", 0.0))

        if not symbol or price <= 0:
            continue

        last = _last_acted.get(symbol)

        # ── FLAT: close any open position ──────────────────────────
        if side == "FLAT":
            qty = await _get_open_qty(symbol)
            if qty > 0 and last is not None:
                close_side = "SELL" if last[0] == "BUY" else "BUY"
                result = await submit_order(symbol, close_side, qty, price)
                if not result.get("error"):
                    log.info("[executor] CLOSE %s qty=%.6f price=%.2f", symbol, qty, price)
                    entry_px = float(last[2]) if len(last) > 2 else price
                    pnl = (price - entry_px) * qty if last[0] == "BUY" else (entry_px - price) * qty
                    asyncio.create_task(_fire_trade_alert(
                        "close", symbol, close_side, qty, price,
                        pnl=pnl, entry_price=entry_px
                    ))
                    _last_acted.pop(symbol, None)
            decision_tracer.record(symbol, HoldReason.SIGNAL_FLAT, {"side": "FLAT", "conf": conf})
            continue

        # ── Confidence gate ─────────────────────────────────────────
        if conf < MIN_CONFIDENCE:
            decision_tracer.record(symbol, HoldReason.LOW_CONFIDENCE, {"conf": conf, "min": MIN_CONFIDENCE})
            continue

        # ── Same signal — no action ──────────────────────────────────
        if last is not None and last[0] == side and last[1] == strat:
            decision_tracer.record(symbol, HoldReason.SIGNAL_UNCHANGED, {"side": side})
            continue

        # ── Close opposite position if exists ────────────────────────
        existing_qty = await _get_open_qty(symbol)
        if existing_qty > 0 and last is not None and last[0] != side:
            close_side = "SELL" if last[0] == "BUY" else "BUY"
            result = await submit_order(symbol, close_side, existing_qty, price)
            if not result.get("error"):
                entry_px = float(last[2]) if len(last) > 2 else price
                pnl = (price - entry_px) * existing_qty if last[0] == "BUY" else (entry_px - price) * existing_qty
                asyncio.create_task(_fire_trade_alert(
                    "close", symbol, close_side, existing_qty, price,
                    pnl=pnl, entry_price=entry_px
                ))
                _last_acted.pop(symbol, None)
                open_count -= 1

        # ── Position cap ─────────────────────────────────────────────
        if open_count >= MAX_POSITIONS:
            decision_tracer.record(symbol, HoldReason.MAX_POSITIONS, {"open": open_count, "max": MAX_POSITIONS})
            continue

        # ── Size and open ────────────────────────────────────────────
        notional = equity * POSITION_PCT
        qty = notional / price
        if qty <= 0:
            continue

        result = await submit_order(symbol, side, qty, price)
        if not result.get("error"):
            log.info("[executor] OPEN %s %s qty=%.6f price=%.2f conf=%.2f", side, symbol, qty, price, conf)
            _last_acted[symbol] = (side, strat, price)
            open_count += 1
            asyncio.create_task(_fire_trade_alert(
                "open", symbol, side, qty, price,
                confidence=conf, strategy=strat
            ))
        else:
            log.warning("[executor] Order failed %s %s: %s", side, symbol, result.get("error"))

    _run_count += 1
    _last_run_at = int(time.time())


_executor_task: asyncio.Task | None = None


async def start_signal_executor() -> None:
    global _running, _executor_task
    if _running:
        return
    _running = True
    _executor_task = asyncio.create_task(_run_loop())
    log.info("[executor] Started (interval=%ds)", EXECUTOR_INTERVAL)


async def stop_executor() -> None:
    global _running, _executor_task
    _running = False
    if _executor_task and not _executor_task.done():
        _executor_task.cancel()
        try:
            await _executor_task
        except asyncio.CancelledError:
            pass
    log.info("[executor] Stopped.")


async def _run_loop() -> None:
    while _running:
        try:
            await _executor_sweep()
        except Exception as exc:
            log.error("[executor] Sweep error: %s", exc)
        await asyncio.sleep(EXECUTOR_INTERVAL)
