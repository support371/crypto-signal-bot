# backend/services/portfolio/service.py
"""
Portfolio & PnL service — paper trading engine.

Handles:
  - Account management (single default account per session)
  - Order lifecycle: MARKET (instant fill) + LIMIT (pending fill on price cross)
  - FIFO position tracking with realized PnL
  - Unrealized PnL via live prices
  - Equity = cash + Σ unrealized PnL
  - Drawdown tracking vs peak equity
  - Equity snapshots (persisted every N seconds)
  - DB persistence for orders, trades, positions, equity snapshots

All amounts in USDT. Paper mode only. No live execution.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional, Tuple

from backend.services.market_data.service import get_price

log = logging.getLogger(__name__)

# Lazy reference for test patching — populated on first use
_evaluate_order = None  # type: ignore

PRECISION   = Decimal("0.00000001")
FEE_RATE    = Decimal("0.001")          # 0.10% taker fee (paper)
STARTING_CASH = Decimal("10000.0")
_SNAPSHOT_INTERVAL = 300                # 5 min equity snapshots
_DEFAULT_ACCOUNT_ID = "paper-default"


# ─────────────────────────────────────────────────────────────────
# Internal data structures
# ─────────────────────────────────────────────────────────────────

@dataclass
class Lot:
    symbol:     str
    qty:        Decimal
    entry_price: Decimal
    opened_at:  int
    order_id:   str


@dataclass
class OrderState:
    id:         str
    account_id: str
    symbol:     str
    side:       str         # BUY | SELL
    order_type: str         # MARKET | LIMIT
    qty:        Decimal
    price:      Optional[Decimal]
    status:     str         # PENDING | FILLED | CANCELLED
    mode:       str = "paper"
    created_at: int = field(default_factory=lambda: int(time.time()))
    updated_at: int = field(default_factory=lambda: int(time.time()))


@dataclass
class TradeState:
    id:          int
    order_id:    str
    account_id:  str
    symbol:      str
    qty:         Decimal
    price:       Decimal
    fee:         Decimal
    side:        str
    realized_pnl: Optional[Decimal]
    executed_at: int


@dataclass
class PositionState:
    symbol:         str
    qty:            Decimal       # signed
    avg_entry_price: Decimal
    realized_pnl:   Decimal
    unrealized_pnl: Decimal


@dataclass
class EquitySnapshot:
    account_id:  str
    equity:      float
    cash:        float
    unrealized:  float
    drawdown_pct: float
    max_equity:  float
    timestamp:   int


# ─────────────────────────────────────────────────────────────────
# In-process state
# ─────────────────────────────────────────────────────────────────

_cash:          Decimal = STARTING_CASH
_lots:          Dict[str, List[Lot]]   = defaultdict(list)
_orders:        Dict[str, OrderState]  = {}
_trades:        List[TradeState]       = []
_trade_counter: int = 0
_peak_equity:   Decimal = STARTING_CASH


def reset_portfolio(starting_cash: Decimal = STARTING_CASH) -> None:
    global _cash, _lots, _orders, _trades, _trade_counter, _peak_equity
    _cash = starting_cash
    _lots.clear()
    _orders.clear()
    _trades.clear()
    _trade_counter = 0
    _peak_equity = starting_cash


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _qty(v) -> Decimal:
    return Decimal(str(v)).quantize(PRECISION, rounding=ROUND_HALF_UP)

def _usd(v) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _fifo_close(
    symbol: str,
    qty_to_close: Decimal,
    fill_price: Decimal,
) -> Tuple[Decimal, Decimal]:
    """
    FIFO close: consume lots, return (avg_cost_basis, realized_pnl).
    Modifies _lots in place.
    """
    remaining = qty_to_close
    total_cost = Decimal("0")
    consumed   = Decimal("0")
    new_lots: List[Lot] = []

    for lot in _lots.get(symbol, []):
        if remaining <= 0:
            new_lots.append(lot)
            continue
        take = min(lot.qty, remaining)
        total_cost += take * lot.entry_price
        consumed   += take
        remaining  -= take
        if lot.qty > take:
            new_lots.append(Lot(
                symbol=lot.symbol, qty=lot.qty - take,
                entry_price=lot.entry_price,
                opened_at=lot.opened_at, order_id=lot.order_id,
            ))

    _lots[symbol] = new_lots

    if consumed == 0:
        return Decimal("0"), Decimal("0")

    avg_cost = total_cost / consumed
    realized = (fill_price - avg_cost) * consumed
    return avg_cost, realized.quantize(PRECISION, rounding=ROUND_HALF_UP)


def _get_position(symbol: str) -> PositionState:
    lots = _lots.get(symbol, [])
    if not lots:
        return PositionState(symbol, Decimal("0"), Decimal("0"), Decimal("0"), Decimal("0"))
    total_qty  = sum(l.qty for l in lots)
    total_cost = sum(l.qty * l.entry_price for l in lots)
    avg_entry  = total_cost / total_qty if total_qty else Decimal("0")
    realized   = sum(
        t.realized_pnl for t in _trades
        if t.symbol == symbol and t.realized_pnl is not None
    )
    return PositionState(
        symbol=symbol, qty=total_qty,
        avg_entry_price=avg_entry.quantize(PRECISION, rounding=ROUND_HALF_UP),
        realized_pnl=realized, unrealized_pnl=Decimal("0"),
    )


# ─────────────────────────────────────────────────────────────────
# Order execution
# ─────────────────────────────────────────────────────────────────

async def submit_order(
    symbol: str,
    side: str,
    order_type: str,
    qty: float,
    price: Optional[float] = None,
    account_id: str = _DEFAULT_ACCOUNT_ID,
) -> OrderState:
    """
    Submit a paper order.

    MARKET: fill immediately at current live price.
    LIMIT:  store as PENDING; filled by _limit_fill_loop when price crosses.
    """
    global _cash, _peak_equity

    order = OrderState(
        id=str(uuid.uuid4()),
        account_id=account_id,
        symbol=symbol.upper(),
        side=side.upper(),
        order_type=order_type.upper(),
        qty=_qty(qty),
        price=_qty(price) if price else None,
        status="PENDING",
    )
    _orders[order.id] = order

    # ── Risk gate (RULE 5: risk always overrides strategy) ─────────────────
    try:
        import sys as _sys
        _self_mod = _sys.modules[__name__]
        _fn = getattr(_self_mod, "_evaluate_order", None)
        if _fn is None:
            import importlib as _il
            _rg = _il.import_module("backend.services.risk_gate.service")
            _fn = _rg.evaluate_order
        decision = await _fn(symbol=symbol, side=side, qty=qty, price=price)
        if not decision.approved:
            order.status    = "CANCELLED"
            order.updated_at = int(time.time())
            log.warning("[portfolio] %s BLOCKED by risk gate: %s",
                        order.id[:8], decision.reasons)
            await _persist_order(order)
            return order
        # Apply size multiplier from risk rules
        if 0 < decision.size_multiplier < 1.0:
            order.qty = _qty(float(order.qty) * decision.size_multiplier)
    except Exception as exc:
        log.warning("[portfolio] risk gate unavailable (%s) — order proceeds", exc)

    if order_type.upper() == "MARKET":
        await _fill_order(order)
    # LIMIT: stays PENDING until price crosses (checked in background loop)

    await _persist_order(order)
    return order


async def _fill_order(order: OrderState) -> None:
    """Execute a fill — updates cash, lots, positions, trades."""
    global _cash, _peak_equity, _trade_counter

    try:
        snap = await get_price(order.symbol)
        fill_price = _qty(snap.price)
    except Exception as exc:
        log.warning("Cannot fill %s — price unavailable: %s", order.id, exc)
        order.status = "CANCELLED"
        order.updated_at = int(time.time())
        return

    now = int(time.time())
    cost  = order.qty * fill_price
    fee   = (cost * FEE_RATE).quantize(PRECISION, rounding=ROUND_HALF_UP)
    realized_pnl: Optional[Decimal] = None

    if order.side == "BUY":
        total_cost = cost + fee
        if total_cost > _cash:
            log.warning("Insufficient cash for %s: need %.2f have %.2f",
                        order.id, total_cost, _cash)
            order.status = "CANCELLED"
            order.updated_at = now
            return
        _cash -= total_cost
        _lots[order.symbol].append(Lot(
            symbol=order.symbol, qty=order.qty,
            entry_price=fill_price, opened_at=now, order_id=order.id,
        ))

    elif order.side == "SELL":
        # Check we have enough long exposure
        held = sum(l.qty for l in _lots.get(order.symbol, []))
        fill_qty = min(order.qty, held)
        if fill_qty <= 0:
            order.status = "CANCELLED"
            order.updated_at = now
            return
        _, realized_pnl = _fifo_close(order.symbol, fill_qty, fill_price)
        proceeds = fill_qty * fill_price - fee
        _cash += proceeds.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    order.status    = "FILLED"
    order.updated_at = now
    _trade_counter += 1

    trade = TradeState(
        id=_trade_counter, order_id=order.id, account_id=order.account_id,
        symbol=order.symbol, qty=order.qty, price=fill_price,
        fee=fee, side=order.side, realized_pnl=realized_pnl, executed_at=now,
    )
    _trades.append(trade)

    # Update peak equity
    equity = await _compute_equity()
    if equity > _peak_equity:
        _peak_equity = equity

    await _persist_trade(trade)
    log.info("[portfolio] FILL %s %s %s qty=%s @ %s  pnl=%s",
             order.side, order.symbol, order.id[:8],
             order.qty, fill_price, realized_pnl)


# ─────────────────────────────────────────────────────────────────
# Equity & PnL
# ─────────────────────────────────────────────────────────────────

async def _compute_equity() -> Decimal:
    """equity = cash + Σ unrealized PnL across open positions."""
    unrealized = Decimal("0")
    for symbol, lots in _lots.items():
        if not lots:
            continue
        try:
            snap = await get_price(symbol)
            mark = _qty(snap.price)
        except Exception:
            continue
        total_qty  = sum(l.qty for l in lots)
        total_cost = sum(l.qty * l.entry_price for l in lots)
        avg_cost   = total_cost / total_qty if total_qty else Decimal("0")
        unrealized += (mark - avg_cost) * total_qty

    return (_cash + unrealized).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def get_portfolio_summary(account_id: str = _DEFAULT_ACCOUNT_ID) -> dict:
    """Return full portfolio summary."""
    now = int(time.time())
    equity   = await _compute_equity()
    drawdown = float((_peak_equity - equity) / _peak_equity * 100) if _peak_equity > 0 else 0.0

    positions = []
    for symbol, lots in _lots.items():
        if not lots:
            continue
        total_qty  = sum(l.qty for l in lots)
        total_cost = sum(l.qty * l.entry_price for l in lots)
        avg_entry  = total_cost / total_qty if total_qty else Decimal("0")
        try:
            snap = await get_price(symbol)
            mark = _qty(snap.price)
            unrealized = (mark - avg_entry) * total_qty
        except Exception:
            mark, unrealized = Decimal("0"), Decimal("0")

        realized = sum(
            t.realized_pnl for t in _trades
            if t.symbol == symbol and t.realized_pnl is not None
        )
        positions.append({
            "symbol":          symbol,
            "qty":             float(total_qty),
            "avg_entry_price": float(avg_entry.quantize(Decimal("0.01"))),
            "mark_price":      float(mark),
            "unrealized_pnl":  float(unrealized.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
            "realized_pnl":    float(realized.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        })

    total_realized   = sum(
        t.realized_pnl for t in _trades if t.realized_pnl is not None
    ) or Decimal("0")
    wins = [t for t in _trades if t.realized_pnl and t.realized_pnl > 0]
    trade_count = len([t for t in _trades if t.side == "SELL"])
    win_rate = (len(wins) / trade_count * 100) if trade_count > 0 else 0.0

    return {
        "account_id":      account_id,
        "cash_balance":    float(_cash),
        "equity":          float(equity),
        "max_equity":      float(_peak_equity),
        "drawdown_pct":    round(drawdown, 4),
        "total_realized_pnl":   float(total_realized.quantize(Decimal("0.01"))),
        "total_unrealized_pnl": float((equity - _cash).quantize(Decimal("0.01"))),
        "trade_count":     trade_count,
        "win_rate_pct":    round(win_rate, 2),
        "open_positions":  positions,
        "as_of":           now,
    }


def get_trades(limit: int = 50, symbol: Optional[str] = None) -> List[dict]:
    trades = _trades if not symbol else [t for t in _trades if t.symbol == symbol.upper()]
    trades = sorted(trades, key=lambda t: t.executed_at, reverse=True)[:limit]
    return [
        {
            "id":          t.id,
            "order_id":    t.order_id,
            "symbol":      t.symbol,
            "side":        t.side,
            "qty":         float(t.qty),
            "price":       float(t.price),
            "fee":         float(t.fee),
            "realized_pnl": float(t.realized_pnl) if t.realized_pnl else None,
            "executed_at": t.executed_at,
        }
        for t in trades
    ]


def get_orders(status: Optional[str] = None, limit: int = 50) -> List[dict]:
    orders = list(_orders.values())
    if status:
        orders = [o for o in orders if o.status == status.upper()]
    orders = sorted(orders, key=lambda o: o.created_at, reverse=True)[:limit]
    return [
        {
            "id":         o.id,
            "symbol":     o.symbol,
            "side":       o.side,
            "order_type": o.order_type,
            "qty":        float(o.qty),
            "price":      float(o.price) if o.price else None,
            "status":     o.status,
            "created_at": o.created_at,
            "updated_at": o.updated_at,
        }
        for o in orders
    ]


def get_order(order_id: str) -> Optional[dict]:
    o = _orders.get(order_id)
    if not o:
        return None
    return {
        "id": o.id, "symbol": o.symbol, "side": o.side,
        "order_type": o.order_type, "qty": float(o.qty),
        "price": float(o.price) if o.price else None,
        "status": o.status, "created_at": o.created_at, "updated_at": o.updated_at,
    }


# ─────────────────────────────────────────────────────────────────
# Equity snapshot loop
# ─────────────────────────────────────────────────────────────────

async def _snapshot_loop() -> None:
    while True:
        await asyncio.sleep(_SNAPSHOT_INTERVAL)
        try:
            equity = await _compute_equity()
            drawdown = float((_peak_equity - equity) / _peak_equity * 100) if _peak_equity > 0 else 0.0
            snap = EquitySnapshot(
                account_id=_DEFAULT_ACCOUNT_ID,
                equity=float(equity),
                cash=float(_cash),
                unrealized=float(equity - _cash),
                drawdown_pct=drawdown,
                max_equity=float(_peak_equity),
                timestamp=int(time.time()),
            )
            await _persist_snapshot(snap)
            log.info("[portfolio] equity=%.2f cash=%.2f drawdown=%.2f%%",
                     snap.equity, snap.cash, snap.drawdown_pct)
        except Exception as exc:
            log.warning("[portfolio] snapshot error: %s", exc)


# ─────────────────────────────────────────────────────────────────
# LIMIT order fill loop
# ─────────────────────────────────────────────────────────────────

async def _limit_fill_loop() -> None:
    """Check pending LIMIT orders every 10s and fill if price has crossed."""
    while True:
        await asyncio.sleep(10)
        pending = [o for o in _orders.values() if o.status == "PENDING" and o.order_type == "LIMIT"]
        for order in pending:
            try:
                snap = await get_price(order.symbol)
                mark = float(snap.price)
                limit = float(order.price)
                if order.side == "BUY"  and mark <= limit:
                    await _fill_order(order)
                    await _persist_order(order)
                elif order.side == "SELL" and mark >= limit:
                    await _fill_order(order)
                    await _persist_order(order)
            except Exception as exc:
                log.debug("limit fill check error %s: %s", order.id[:8], exc)


# ─────────────────────────────────────────────────────────────────
# DB persistence (best-effort)
# ─────────────────────────────────────────────────────────────────

async def _persist_order(order: OrderState) -> None:
    try:
        from backend.db.session import get_session
        from backend.db.models import PaperOrderRecord
        async with get_session() as session:
            from sqlalchemy import select
            existing = await session.get(PaperOrderRecord, order.id)
            if existing:
                existing.status = order.status
                existing.updated_at = order.updated_at
            else:
                session.add(PaperOrderRecord(
                    id=order.id, account_id=order.account_id,
                    symbol=order.symbol, side=order.side,
                    order_type=order.order_type, qty=float(order.qty),
                    price=float(order.price) if order.price else None,
                    status=order.status, mode=order.mode,
                    created_at=order.created_at, updated_at=order.updated_at,
                ))
            await session.commit()
    except Exception as exc:
        log.debug("order persist error (non-fatal): %s", exc)


async def _persist_trade(trade: TradeState) -> None:
    try:
        from backend.db.session import get_session
        from backend.db.models import TradeRecord
        async with get_session() as session:
            session.add(TradeRecord(
                order_id=trade.order_id, account_id=trade.account_id,
                symbol=trade.symbol, qty=float(trade.qty),
                price=float(trade.price), fee=float(trade.fee),
                side=trade.side,
                realized_pnl=float(trade.realized_pnl) if trade.realized_pnl is not None else None,
                executed_at=trade.executed_at,
            ))
            await session.commit()
    except Exception as exc:
        log.debug("trade persist error (non-fatal): %s", exc)


async def _persist_snapshot(snap: EquitySnapshot) -> None:
    try:
        from backend.db.session import get_session
        from backend.db.models import EquitySnapshotRecord
        async with get_session() as session:
            session.add(EquitySnapshotRecord(
                account_id=snap.account_id, equity=snap.equity,
                cash=snap.cash, unrealized=snap.unrealized,
                drawdown_pct=snap.drawdown_pct, max_equity=snap.max_equity,
                timestamp=snap.timestamp,
            ))
            await session.commit()
    except Exception as exc:
        log.debug("snapshot persist error (non-fatal): %s", exc)


# ─────────────────────────────────────────────────────────────────
# Startup
# ─────────────────────────────────────────────────────────────────

def start_portfolio_service(app) -> None:
    # Direct task creation — called from lifespan() which is already async
    asyncio.create_task(_snapshot_loop())
    asyncio.create_task(_limit_fill_loop())
