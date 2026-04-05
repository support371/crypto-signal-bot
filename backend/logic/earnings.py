"""
Earnings ledger for paper trading.

Tracks realized P&L from filled orders by pairing BUY fills with subsequent SELL fills
per symbol. Persists to a JSON file (EARNINGS_STORE_PATH env var) for durability.
"""

import os
import json
import time
import threading
from typing import Dict, List, Optional

_STORE_PATH = os.getenv("EARNINGS_STORE_PATH", "backend/data/earnings.json")
_lock = threading.Lock()

# In-memory open positions per symbol: symbol -> list of {qty, cost_basis}
# Each BUY pushes a lot; each SELL pops lots FIFO to compute realized P&L
_open_lots: Dict[str, List[Dict]] = {}

# Closed trade records
_closed_trades: List[Dict] = []


# ---------------------------------------------------------------------------
# Persistence helpers
# ---------------------------------------------------------------------------

def _load() -> None:
    """Load persisted earnings data into memory (called once at import)."""
    global _open_lots, _closed_trades
    try:
        with open(_STORE_PATH, "r") as f:
            data = json.load(f)
        _open_lots = data.get("open_lots", {})
        _closed_trades = data.get("closed_trades", [])
    except (FileNotFoundError, json.JSONDecodeError):
        _open_lots = {}
        _closed_trades = []


def _save() -> None:
    """Persist current earnings state to disk."""
    os.makedirs(os.path.dirname(_STORE_PATH) or ".", exist_ok=True)
    with open(_STORE_PATH, "w") as f:
        json.dump({"open_lots": _open_lots, "closed_trades": _closed_trades}, f, indent=2)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def record_fill(
    *,
    symbol: str,
    side: str,
    quantity: float,
    fill_price: float,
    intent_id: str,
    timestamp: Optional[float] = None,
) -> None:
    """
    Record a filled order into the earnings ledger.

    BUY fills open a new lot. SELL fills close against open lots (FIFO),
    realizing P&L for each matched quantity.
    """
    ts = timestamp or time.time()
    sym = symbol.upper()

    with _lock:
        if side.upper() == "BUY":
            if sym not in _open_lots:
                _open_lots[sym] = []
            _open_lots[sym].append({
                "qty": quantity,
                "cost_basis": fill_price,
                "intent_id": intent_id,
                "opened_at": ts,
            })
            _save()
            return

        # SELL — match against open lots FIFO
        if sym not in _open_lots or not _open_lots[sym]:
            # No open lots to match against — still record as a standalone sale
            _closed_trades.append({
                "symbol": sym,
                "side": "SELL",
                "quantity": quantity,
                "entry_price": None,
                "exit_price": fill_price,
                "realized_pnl": 0.0,
                "pnl_pct": 0.0,
                "intent_id": intent_id,
                "closed_at": ts,
                "note": "no_open_lot",
            })
            _save()
            return

        remaining_qty = quantity
        lots = _open_lots[sym]

        while remaining_qty > 1e-10 and lots:
            lot = lots[0]
            matched_qty = min(remaining_qty, lot["qty"])
            realized_pnl = (fill_price - lot["cost_basis"]) * matched_qty
            pnl_pct = ((fill_price - lot["cost_basis"]) / lot["cost_basis"]) * 100 if lot["cost_basis"] > 0 else 0.0

            _closed_trades.append({
                "symbol": sym,
                "side": "SELL",
                "quantity": matched_qty,
                "entry_price": lot["cost_basis"],
                "exit_price": fill_price,
                "realized_pnl": round(realized_pnl, 8),
                "pnl_pct": round(pnl_pct, 4),
                "intent_id": intent_id,
                "opened_at": lot["opened_at"],
                "closed_at": ts,
            })

            lot["qty"] -= matched_qty
            remaining_qty -= matched_qty

            if lot["qty"] <= 1e-10:
                lots.pop(0)

        if not lots:
            del _open_lots[sym]

        _save()


def get_summary() -> Dict:
    """
    Return aggregate earnings summary.

    Returns total realized P&L, trade count, win rate, average P&L per trade,
    best trade, worst trade, and open lot count.
    """
    with _lock:
        trades = [t for t in _closed_trades if t.get("entry_price") is not None]
        total_pnl = sum(t["realized_pnl"] for t in trades)
        wins = [t for t in trades if t["realized_pnl"] > 0]
        losses = [t for t in trades if t["realized_pnl"] < 0]
        win_rate = (len(wins) / len(trades) * 100) if trades else 0.0
        avg_pnl = (total_pnl / len(trades)) if trades else 0.0
        best = max(trades, key=lambda t: t["realized_pnl"])["realized_pnl"] if trades else 0.0
        worst = min(trades, key=lambda t: t["realized_pnl"])["realized_pnl"] if trades else 0.0
        open_lot_count = sum(len(v) for v in _open_lots.values())

        return {
            "total_realized_pnl": round(total_pnl, 8),
            "trade_count": len(trades),
            "win_count": len(wins),
            "loss_count": len(losses),
            "win_rate_pct": round(win_rate, 2),
            "avg_pnl_per_trade": round(avg_pnl, 8),
            "best_trade_pnl": round(best, 8),
            "worst_trade_pnl": round(worst, 8),
            "open_lots": open_lot_count,
        }


def get_history(symbol: Optional[str] = None, limit: int = 100) -> List[Dict]:
    """Return closed trade records, optionally filtered by symbol, newest first."""
    with _lock:
        trades = list(_closed_trades)

    if symbol:
        trades = [t for t in trades if t["symbol"] == symbol.upper()]

    trades.sort(key=lambda t: t.get("closed_at", 0), reverse=True)
    return trades[:limit]


def reset_earnings() -> None:
    """Clear all earnings data (paper mode utility)."""
    global _open_lots, _closed_trades
    with _lock:
        _open_lots = {}
        _closed_trades = []
        _save()


# Load persisted data on module import
_load()
