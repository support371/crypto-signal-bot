"""
Paper trading engine.

Simulates order fills against a paper portfolio with realistic slippage.
"""

import time
import random
from typing import Dict, List, Optional
from dataclasses import dataclass, field

from backend.models.execution_intent import (
    ExecutionIntent,
    IntentStatus,
    Side,
    OrderType,
)


@dataclass
class PaperPosition:
    asset: str
    free: float = 0.0
    locked: float = 0.0


@dataclass
class PaperPortfolio:
    """In-memory paper portfolio with USDT as base currency."""

    balances: Dict[str, float] = field(default_factory=lambda: {"USDT": 10000.0})
    positions: List[PaperPosition] = field(default_factory=list)
    open_orders: List[ExecutionIntent] = field(default_factory=list)
    filled_orders: List[ExecutionIntent] = field(default_factory=list)

    def get_balance(self, asset: str) -> float:
        return self.balances.get(asset, 0.0)

    def get_all_balances(self) -> Dict[str, str]:
        return {k: str(v) for k, v in self.balances.items()}

    def get_positions(self) -> List[Dict[str, str]]:
        result = []
        for asset, amount in self.balances.items():
            if amount > 0:
                result.append({"asset": asset, "free": str(amount)})
        return result


def simulate_fill(
    intent: ExecutionIntent,
    portfolio: PaperPortfolio,
    market_price: Optional[float] = None,
) -> ExecutionIntent:
    """
    Simulate filling an order in paper mode.

    Applies realistic slippage (0.01-0.05%) and updates the paper portfolio.
    """
    # Determine fill price
    if intent.order_type == OrderType.LIMIT and intent.price is not None:
        base_price = intent.price
    elif market_price is not None:
        base_price = market_price
    else:
        # Fallback: use a synthetic price based on symbol
        base_price = _synthetic_price(intent.symbol)

    # Apply slippage
    slippage_pct = random.uniform(0.0001, 0.0005)
    if intent.side == Side.BUY:
        fill_price = base_price * (1 + slippage_pct)
    else:
        fill_price = base_price * (1 - slippage_pct)

    fill_price = round(fill_price, 8)
    fill_quantity = intent.quantity

    # Extract base and quote assets from symbol (e.g., BTCUSDT -> BTC, USDT)
    base_asset, quote_asset = _parse_symbol(intent.symbol)
    cost = fill_price * fill_quantity

    if intent.side == Side.BUY:
        quote_balance = portfolio.get_balance(quote_asset)
        if quote_balance < cost:
            intent.status = IntentStatus.FAILED
            intent.notes = f"Insufficient {quote_asset} balance: {quote_balance:.2f} < {cost:.2f}"
            intent.updated_at = time.time()
            return intent

        portfolio.balances[quote_asset] = quote_balance - cost
        portfolio.balances[base_asset] = portfolio.get_balance(base_asset) + fill_quantity

    else:  # SELL
        base_balance = portfolio.get_balance(base_asset)
        if base_balance < fill_quantity:
            intent.status = IntentStatus.FAILED
            intent.notes = f"Insufficient {base_asset} balance: {base_balance:.8f} < {fill_quantity:.8f}"
            intent.updated_at = time.time()
            return intent

        portfolio.balances[base_asset] = base_balance - fill_quantity
        portfolio.balances[quote_asset] = portfolio.get_balance(quote_asset) + cost

    intent.status = IntentStatus.FILLED
    intent.fill_price = fill_price
    intent.fill_quantity = fill_quantity
    intent.notes = f"Paper fill at {fill_price:.8f} (slippage: {slippage_pct*100:.3f}%)"
    intent.updated_at = time.time()

    portfolio.filled_orders.append(intent)
    return intent


def _parse_symbol(symbol: str) -> tuple:
    """Parse a trading pair symbol into base and quote assets."""
    quote_currencies = ["USDT", "USDC", "BUSD", "BTC", "ETH", "BNB"]
    for quote in quote_currencies:
        if symbol.endswith(quote):
            base = symbol[: -len(quote)]
            if base:
                return base, quote
    # Fallback
    return symbol[:3], symbol[3:]


def _synthetic_price(symbol: str) -> float:
    """Return a rough synthetic price for common pairs when no market data is available."""
    prices = {
        "BTCUSDT": 43000.0,
        "ETHUSDT": 2600.0,
        "BNBUSDT": 310.0,
        "SOLUSDT": 100.0,
        "ADAUSDT": 0.55,
        "XRPUSDT": 0.62,
        "DOGEUSDT": 0.08,
        "DOTUSDT": 7.5,
    }
    base_price = prices.get(symbol.upper(), 100.0)
    # Add some noise
    return base_price * (1 + random.uniform(-0.001, 0.001))
