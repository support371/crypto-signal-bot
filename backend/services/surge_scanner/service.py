# backend/services/surge_scanner/service.py
"""
Surge Scanner — 20-minute rolling price-jump detector.

Every SCAN_INTERVAL seconds the loop:
  1. Fetches current price for each WATCHED_SYMBOLS coin.
  2. Compares against the price recorded ~20 minutes ago (stored in ring buffer).
  3. If the % change >= SURGE_THRESHOLD_HIGH (15–20%):
       - Fires a STRONG_SURGE alert → executor buys 10% of equity
  4. If the % change >= SURGE_THRESHOLD_MID (5–10%):
       - Fires a NORMAL_SURGE alert → executor buys 5% of equity
  5. Stop-loss check: if any open position is down >= STOP_LOSS_PCT (5%)
       - Fires an EXIT alert → executor closes that position immediately

Design decisions
----------------
- WATCHED_SYMBOLS: top coins by market cap (BTC, ETH, SOL, BNB only)
- Price ring buffer keeps 20 minutes of snapshots (ring size = 20min / SCAN_INTERVAL)
- Paper-mode only — no live exchange calls
- All alerts are fed to signal_executor via _surge_alert_queue
- Guardian kill switch is respected — no alerts fired if kill switch is active
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, List, Optional, Tuple

log = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────────────
WATCHED_SYMBOLS: List[str] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
SCAN_INTERVAL: int = 60          # seconds between scans
WINDOW_MINUTES: int = 20         # rolling window for surge detection
STOP_LOSS_PCT: float = 0.05      # 5% unrealized loss → exit
SURGE_THRESHOLD_MID: float = 0.05   # 5%  price jump → normal buy (5% equity)
SURGE_THRESHOLD_HIGH: float = 0.15  # 15% price jump → strong buy (10% equity)

NORMAL_POSITION_PCT: float = 0.05   # 5% of equity for mid-tier surges
STRONG_POSITION_PCT: float = 0.10   # 10% of equity for high-tier surges

# ── Internal state ─────────────────────────────────────────────────────────────
_running: bool = False
_run_count: int = 0
_last_run_at: int = 0
_alerts_fired: int = 0
_stop_losses_triggered: int = 0

# Ring buffer: symbol → deque of (timestamp, price)
_RING_SIZE: int = WINDOW_MINUTES  # one entry per minute
_price_history: Dict[str, Deque[Tuple[int, float]]] = {
    sym: deque(maxlen=_RING_SIZE) for sym in WATCHED_SYMBOLS
}

# Latest surge status per symbol
_surge_status: Dict[str, dict] = {}


@dataclass
class SurgeAlert:
    symbol: str
    alert_type: str          # "NORMAL_SURGE" | "STRONG_SURGE" | "STOP_LOSS_EXIT"
    current_price: float
    reference_price: float
    pct_change: float
    position_pct: float      # how much equity to deploy / close
    fired_at: int = field(default_factory=lambda: int(time.time()))


# Shared queue that the executor watches
_surge_alert_queue: asyncio.Queue = asyncio.Queue(maxsize=100)


def get_surge_status() -> dict:
    return {
        "running": _running,
        "run_count": _run_count,
        "last_run_at": _last_run_at,
        "alerts_fired": _alerts_fired,
        "stop_losses_triggered": _stop_losses_triggered,
        "watched_symbols": WATCHED_SYMBOLS,
        "surge_status": _surge_status,
        "config": {
            "scan_interval_seconds": SCAN_INTERVAL,
            "window_minutes": WINDOW_MINUTES,
            "stop_loss_pct": STOP_LOSS_PCT,
            "surge_threshold_mid": SURGE_THRESHOLD_MID,
            "surge_threshold_high": SURGE_THRESHOLD_HIGH,
            "normal_position_pct": NORMAL_POSITION_PCT,
            "strong_position_pct": STRONG_POSITION_PCT,
        },
    }


async def _get_current_price(symbol: str) -> Optional[float]:
    """Fetch latest price from market data service."""
    try:
        from backend.services.market_data.service import get_price, MarketDataStale
        try:
            snap = await get_price(symbol)
            return float(snap.price)
        except MarketDataStale as e:
            if e.stale_ticker and e.stale_ticker.price > 0:
                return float(e.stale_ticker.price)
        return None
    except Exception as exc:
        log.debug("[surge_scanner] price fetch failed %s: %s", symbol, exc)
        return None


async def _get_open_position_entry(symbol: str) -> Optional[float]:
    """Return average entry price for an open position, or None if no position."""
    try:
        import backend.services.portfolio.service as port_svc
        sym = symbol.upper()
        lots = port_svc._lots.get(sym, [])
        if not lots:
            return None
        total_qty = sum(float(l.qty) for l in lots)
        if total_qty <= 0:
            return None
        total_cost = sum(float(l.qty) * float(l.entry_price) for l in lots)
        return total_cost / total_qty
    except Exception:
        return None


async def _close_position_emergency(symbol: str) -> None:
    """Emergency stop-loss exit — closes full position at market."""
    try:
        import backend.services.portfolio.service as port_svc
        sym = symbol.upper()
        lots = port_svc._lots.get(sym, [])
        total_qty = sum(float(l.qty) for l in lots)
        if total_qty <= 0:
            return
        order = await port_svc.submit_order(
            symbol=sym, side="SELL",
            order_type="MARKET", qty=total_qty,
        )
        log.warning(
            "[surge_scanner] STOP-LOSS EXIT %s qty=%.6f → order=%s status=%s",
            sym, total_qty, order.id[:8], order.status,
        )
    except Exception as exc:
        log.error("[surge_scanner] emergency close failed %s: %s", symbol, exc)


async def _open_surge_position(symbol: str, position_pct: float) -> None:
    """Open a surge-driven BUY position sized by position_pct of equity."""
    try:
        from backend.services.portfolio.service import get_portfolio_summary, submit_order
        summary = await get_portfolio_summary()
        equity = float(summary.get("equity", 10000.0))
        price = await _get_current_price(symbol)
        if not price or price <= 0:
            return
        notional = equity * position_pct
        if notional < 10.0:
            return
        qty = notional / price
        order = await submit_order(
            symbol=symbol, side="BUY",
            order_type="MARKET", qty=qty,
        )
        log.info(
            "[surge_scanner] SURGE BUY %s qty=%.6f notional=%.2f @ %.4f → order=%s status=%s",
            symbol, qty, notional, price, order.id[:8], order.status,
        )
    except Exception as exc:
        log.warning("[surge_scanner] surge buy failed %s: %s", symbol, exc)


async def _scan_symbol(symbol: str) -> Optional[SurgeAlert]:
    """Scan one symbol. Returns a SurgeAlert if action required, else None."""
    global _alerts_fired, _stop_losses_triggered

    current_price = await _get_current_price(symbol)
    if current_price is None or current_price <= 0:
        return None

    now = int(time.time())

    # ── Stop-loss check (priority 1) ──────────────────────────────────────────
    entry_price = await _get_open_position_entry(symbol)
    if entry_price and entry_price > 0:
        loss_pct = (current_price - entry_price) / entry_price  # negative = loss
        if loss_pct <= -STOP_LOSS_PCT:
            log.warning(
                "[surge_scanner] STOP LOSS %s entry=%.4f now=%.4f loss=%.2f%%",
                symbol, entry_price, current_price, loss_pct * 100,
            )
            await _close_position_emergency(symbol)
            _stop_losses_triggered += 1
            _alerts_fired += 1
            alert = SurgeAlert(
                symbol=symbol,
                alert_type="STOP_LOSS_EXIT",
                current_price=current_price,
                reference_price=entry_price,
                pct_change=loss_pct,
                position_pct=0.0,
            )
            _surge_status[symbol] = {
                "type": "STOP_LOSS_EXIT",
                "pct_change": round(loss_pct * 100, 2),
                "at": now,
            }
            return alert

    # ── Price history: store snapshot ─────────────────────────────────────────
    history = _price_history[symbol]
    history.append((now, current_price))

    # Need at least 2 snapshots (reference + current)
    if len(history) < 2:
        return None

    # Reference price = oldest snapshot in the 20-min window
    ref_ts, ref_price = history[0]
    if ref_price <= 0:
        return None

    # Only use reference if it is actually ~20 min old (within 30% tolerance)
    age_minutes = (now - ref_ts) / 60
    if age_minutes < 1:
        return None  # too fresh — wait for window to build

    pct_change = (current_price - ref_price) / ref_price

    # ── Surge detection ───────────────────────────────────────────────────────
    # Only fire surges on UPWARD moves
    if pct_change >= SURGE_THRESHOLD_HIGH:
        alert_type = "STRONG_SURGE"
        position_pct = STRONG_POSITION_PCT
    elif pct_change >= SURGE_THRESHOLD_MID:
        alert_type = "NORMAL_SURGE"
        position_pct = NORMAL_POSITION_PCT
    else:
        _surge_status[symbol] = {
            "type": "WATCHING",
            "pct_change": round(pct_change * 100, 2),
            "ref_age_minutes": round(age_minutes, 1),
            "at": now,
        }
        return None

    log.info(
        "[surge_scanner] %s %s ref=%.4f now=%.4f Δ=%.2f%% → deploy %.0f%% equity",
        alert_type, symbol, ref_price, current_price, pct_change * 100, position_pct * 100,
    )

    # Execute surge buy
    await _open_surge_position(symbol, position_pct)
    _alerts_fired += 1

    _surge_status[symbol] = {
        "type": alert_type,
        "pct_change": round(pct_change * 100, 2),
        "ref_age_minutes": round(age_minutes, 1),
        "position_pct": position_pct,
        "at": now,
    }

    return SurgeAlert(
        symbol=symbol,
        alert_type=alert_type,
        current_price=current_price,
        reference_price=ref_price,
        pct_change=pct_change,
        position_pct=position_pct,
    )


async def _scanner_loop() -> None:
    global _running, _run_count, _last_run_at
    _running = True
    log.info(
        "[surge_scanner] started | symbols=%s | window=%dmin | stop_loss=%.0f%% | mid=%.0f%% | high=%.0f%%",
        WATCHED_SYMBOLS, WINDOW_MINUTES,
        STOP_LOSS_PCT * 100, SURGE_THRESHOLD_MID * 100, SURGE_THRESHOLD_HIGH * 100,
    )

    # Let market data service warm up
    await asyncio.sleep(45)

    while _running:
        try:
            # Respect Guardian kill switch
            from backend.services.guardian_bot.service import is_kill_switch_active
            if await is_kill_switch_active():
                log.info("[surge_scanner] kill switch active — scan paused")
                await asyncio.sleep(SCAN_INTERVAL)
                continue

            _run_count += 1
            _last_run_at = int(time.time())

            for symbol in WATCHED_SYMBOLS:
                try:
                    await _scan_symbol(symbol)
                except Exception as exc:
                    log.warning("[surge_scanner] scan error %s: %s", symbol, exc)

        except Exception as exc:
            log.error("[surge_scanner] loop error: %s", exc)

        await asyncio.sleep(SCAN_INTERVAL)


async def start_surge_scanner() -> None:
    """Launch the surge scanner as a background task."""
    asyncio.create_task(_scanner_loop(), name="surge_scanner")
    log.info("[surge_scanner] background task created")


async def stop_surge_scanner() -> None:
    global _running
    _running = False
    log.info("[surge_scanner] stopped")
