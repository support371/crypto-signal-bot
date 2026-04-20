# backend/engine/pnl.py
"""
PHASE 9 — P&L computation service.

Responsibilities:
  - Realized P&L: computed at order fill time from cost basis vs fill price
  - Unrealized P&L: computed against current mark price from MarketDataService
  - Position tracking: FIFO lot accounting per symbol
  - Balance updates: USDT balance adjusts on every fill

Rules:
  - No fabricated P&L values
  - Unrealized P&L requires live price from MarketDataService (Phase 6)
  - Paper and live modes use identical P&L logic; only the fill source differs
  - Rule 5: If guardian is active, P&L reads still work — execution is blocked,
    not P&L reporting

Protected files: none accessed here.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

log = logging.getLogger(__name__)

PRECISION = Decimal("0.00000001")   # 8 decimal places (standard crypto)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass
class Lot:
    """A single position lot (FIFO entry)."""
    symbol:        str
    side:          str          # "BUY" or "SELL"
    quantity:      Decimal
    cost_basis:    Decimal      # price paid per unit
    opened_at:     int          # unix seconds
    order_id:      str


@dataclass
class RealizedTrade:
    symbol:        str
    side:          str          # "BUY" (opened) or "SELL" (closed)
    quantity:      Decimal
    open_price:    Decimal
    close_price:   Decimal
    realized_pnl:  Decimal      # positive = profit
    pnl_pct:       float        # percentage
    opened_at:     int
    closed_at:     int
    order_id:      str


@dataclass
class UnrealizedPosition:
    symbol:         str
    net_quantity:   Decimal     # positive = long, negative = short
    avg_cost:       Decimal
    mark_price:     Decimal
    unrealized_pnl: Decimal
    pnl_pct:        float
    as_of:          int


@dataclass
class PnlSummary:
    total_realized_pnl:    Decimal
    total_unrealized_pnl:  Decimal
    total_pnl:             Decimal
    trade_count:           int
    win_rate_pct:          float
    open_lots:             int
    best_trade_pnl:        Decimal
    worst_trade_pnl:       Decimal
    avg_pnl_per_trade:     Decimal
    as_of:                 int


# ---------------------------------------------------------------------------
# In-process P&L state
# Replaced by DB repository in Phase 11; this serves as the in-memory
# authoritative state until persistence is wired.
# ---------------------------------------------------------------------------

_lots:             dict[str, list[Lot]]       = {}  # symbol → [Lot, ...]
_realized_trades:  list[RealizedTrade]        = []
_usdt_balance:     Decimal = Decimal("10000") # paper starting balance


def reset_pnl_state(starting_balance: Decimal = Decimal("10000")) -> None:
    """Reset all P&L state (for paper trading reset or tests)."""
    global _lots, _realized_trades, _usdt_balance
    _lots.clear()
    _realized_trades.clear()
    _usdt_balance = starting_balance


# ---------------------------------------------------------------------------
# Fill processing — called by coordinator on every confirmed fill
# ---------------------------------------------------------------------------

def process_fill(
    order_id:   str,
    symbol:     str,
    side:       str,
    quantity:   Decimal,
    fill_price: Decimal,
    filled_at:  int,
) -> Optional[RealizedTrade]:
    """
    Process a confirmed fill and update P&L state.

    BUY fill:
      - Deduct USDT cost from balance
      - Add lot to open positions

    SELL fill:
      - Consume lots FIFO
      - Compute realized P&L
      - Add USDT proceeds to balance
      - Return RealizedTrade

    Returns RealizedTrade on SELL, None on BUY.
    """
    global _usdt_balance
    cost = (quantity * fill_price).quantize(PRECISION, rounding=ROUND_HALF_UP)

    if side.upper() == "BUY":
        _usdt_balance -= cost
        if symbol not in _lots:
            _lots[symbol] = []
        _lots[symbol].append(Lot(
            symbol=symbol, side="BUY", quantity=quantity,
            cost_basis=fill_price, opened_at=filled_at, order_id=order_id,
        ))
        log.info("BUY fill: %s qty=%s @ %s — USDT balance: %s", symbol, quantity, fill_price, _usdt_balance)
        return None

    elif side.upper() == "SELL":
        # FIFO: consume lots in order
        remaining = quantity
        total_cost_basis = Decimal("0")
        lots_consumed = Decimal("0")

        symbol_lots = _lots.get(symbol, [])
        new_lots: list[Lot] = []

        for lot in symbol_lots:
            if remaining <= 0:
                new_lots.append(lot)
                continue
            if lot.quantity <= remaining:
                # Consume entire lot
                total_cost_basis += lot.quantity * lot.cost_basis
                lots_consumed += lot.quantity
                remaining -= lot.quantity
            else:
                # Partial lot
                total_cost_basis += remaining * lot.cost_basis
                lots_consumed += remaining
                new_lots.append(Lot(
                    symbol=lot.symbol, side=lot.side,
                    quantity=lot.quantity - remaining,
                    cost_basis=lot.cost_basis,
                    opened_at=lot.opened_at, order_id=lot.order_id,
                ))
                remaining = Decimal("0")

        _lots[symbol] = new_lots

        if lots_consumed > 0:
            avg_cost = (total_cost_basis / lots_consumed).quantize(PRECISION, rounding=ROUND_HALF_UP)
            realized_pnl = ((fill_price - avg_cost) * lots_consumed).quantize(PRECISION, rounding=ROUND_HALF_UP)
            pnl_pct = float(realized_pnl / total_cost_basis * 100) if total_cost_basis > 0 else 0.0
            proceeds = (lots_consumed * fill_price).quantize(PRECISION, rounding=ROUND_HALF_UP)
            _usdt_balance += proceeds

            trade = RealizedTrade(
                symbol=symbol, side="SELL",
                quantity=lots_consumed, open_price=avg_cost,
                close_price=fill_price, realized_pnl=realized_pnl,
                pnl_pct=pnl_pct, opened_at=0, closed_at=filled_at,
                order_id=order_id,
            )
            _realized_trades.append(trade)
            log.info(
                "SELL fill: %s qty=%s @ %s — realized P&L: %s (%.2f%%) — USDT balance: %s",
                symbol, lots_consumed, fill_price, realized_pnl, pnl_pct, _usdt_balance,
            )
            return trade

    return None


# ---------------------------------------------------------------------------
# Unrealized P&L — requires live price
# ---------------------------------------------------------------------------

async def compute_unrealized_positions() -> list[UnrealizedPosition]:
    """
    Compute unrealized P&L for all open positions using live prices.
    Returns empty list if market data is unavailable (not fabricated values).
    """
    from backend.services.market_data.service import get_price, MarketDataUnavailable
    positions: list[UnrealizedPosition] = []
    now = int(time.time())

    for symbol, lots in _lots.items():
        if not lots:
            continue

        # Aggregate lots into a net position
        total_qty = sum(lot.quantity for lot in lots)
        total_cost = sum(lot.quantity * lot.cost_basis for lot in lots)
        avg_cost = (total_cost / total_qty).quantize(PRECISION) if total_qty > 0 else Decimal("0")

        # Fetch live mark price
        try:
            snap = await get_price(symbol)
            mark = snap.price
        except MarketDataUnavailable:
            # Can't compute unrealized without live price — skip, don't fabricate
            log.debug("Cannot compute unrealized P&L for %s — market data unavailable", symbol)
            continue
        except Exception as exc:
            log.warning("Unrealized P&L price fetch error for %s: %s", symbol, exc)
            continue

        unrealized = ((mark - avg_cost) * total_qty).quantize(PRECISION, rounding=ROUND_HALF_UP)
        pnl_pct = float(unrealized / total_cost * 100) if total_cost > 0 else 0.0

        positions.append(UnrealizedPosition(
            symbol=symbol, net_quantity=total_qty,
            avg_cost=avg_cost, mark_price=mark,
            unrealized_pnl=unrealized, pnl_pct=pnl_pct,
            as_of=now,
        ))

    return positions


# ---------------------------------------------------------------------------
# P&L summary
# ---------------------------------------------------------------------------

async def get_pnl_summary() -> PnlSummary:
    """
    Return aggregated P&L summary.
    Unrealized component uses live prices (returns 0 if unavailable).
    """
    now = int(time.time())
    unrealized_positions = await compute_unrealized_positions()
    total_unrealized = sum(p.unrealized_pnl for p in unrealized_positions) or Decimal("0")
    total_realized   = sum(t.realized_pnl for t in _realized_trades) or Decimal("0")
    trade_count      = len(_realized_trades)

    wins = [t for t in _realized_trades if t.realized_pnl > 0]
    win_rate = (len(wins) / trade_count * 100) if trade_count > 0 else 0.0

    pnls = [t.realized_pnl for t in _realized_trades]
    best  = max(pnls, default=Decimal("0"))
    worst = min(pnls, default=Decimal("0"))
    avg   = (total_realized / trade_count).quantize(PRECISION) if trade_count > 0 else Decimal("0")

    open_lots = sum(len(v) for v in _lots.values())

    return PnlSummary(
        total_realized_pnl=total_realized,
        total_unrealized_pnl=total_unrealized,
        total_pnl=total_realized + total_unrealized,
        trade_count=trade_count,
        win_rate_pct=win_rate,
        open_lots=open_lots,
        best_trade_pnl=best,
        worst_trade_pnl=worst,
        avg_pnl_per_trade=avg,
        as_of=now,
    )


def get_usdt_balance() -> Decimal:
    return _usdt_balance


def get_all_lots() -> dict[str, list[Lot]]:
    return {k: list(v) for k, v in _lots.items()}


def get_realized_trades() -> list[RealizedTrade]:
    return list(_realized_trades)
