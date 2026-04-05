"""
Exchange adapter abstraction.

Provides a unified interface for order execution and balance queries across
paper mode and live exchange connections.

Adapter selection (controlled entirely by environment variables):

  TRADING_MODE=paper          → PaperAdapter (default, always safe)
  TRADING_MODE=live + NETWORK=testnet  → BinanceCCXTAdapter(testnet=True)
  TRADING_MODE=live + NETWORK=mainnet  → BinanceCCXTAdapter(testnet=False)

The CCXT adapter is only instantiated when TRADING_MODE=live is explicitly set
AND valid API credentials are present. It degrades gracefully to paper mode if
the ccxt package is not installed.
"""

import logging
import os
import time
from abc import ABC, abstractmethod
from typing import Dict, Optional

logger = logging.getLogger("backend.exchange_adapter")


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class ExchangeAdapter(ABC):
    """Minimal interface that all adapters must implement."""

    @abstractmethod
    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: Optional[float] = None,
    ) -> Dict:
        """
        Place an order. Returns a dict with at least:
          { id, symbol, side, order_type, quantity, fill_price, status, timestamp }
        """

    @abstractmethod
    def get_balance(self, asset: str = "USDT") -> float:
        """Return free balance for the given asset."""

    @abstractmethod
    def get_price(self, symbol: str) -> float:
        """Return current market price for symbol (e.g. 'BTC/USDT')."""

    @property
    @abstractmethod
    def mode(self) -> str:
        """Human-readable adapter mode label, e.g. 'paper', 'testnet', 'mainnet'."""


# ---------------------------------------------------------------------------
# Paper adapter — wraps the existing PaperPortfolio engine
# ---------------------------------------------------------------------------

class PaperAdapter(ExchangeAdapter):
    """
    Routes all execution through the in-process paper portfolio.
    No network calls. Always safe.
    """

    def __init__(self, portfolio, synthetic_price_fn):
        self._portfolio = portfolio
        self._synthetic_price = synthetic_price_fn

    @property
    def mode(self) -> str:
        return "paper"

    def get_price(self, symbol: str) -> float:
        return self._synthetic_price(symbol.replace("/", "").upper())

    def get_balance(self, asset: str = "USDT") -> float:
        return self._portfolio.get_balance(asset)

    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: Optional[float] = None,
    ) -> Dict:
        from backend.logic.paper_trading import simulate_fill
        from backend.models.execution_intent import (
            ExecutionIntent,
            IntentStatus,
            OrderType,
            Side,
        )

        intent = ExecutionIntent(
            symbol=symbol.upper().replace("/", ""),
            side=Side(side.upper()),
            order_type=OrderType(order_type.upper()),
            quantity=quantity,
            price=price,
            mode="paper",
        )
        market_price = self._synthetic_price(intent.symbol)
        filled_intent = simulate_fill(intent, self._portfolio, market_price)

        return {
            "id": filled_intent.id,
            "symbol": filled_intent.symbol,
            "side": filled_intent.side.value,
            "order_type": filled_intent.order_type.value,
            "quantity": filled_intent.fill_quantity or quantity,
            "fill_price": filled_intent.fill_price,
            "status": filled_intent.status.value,
            "notes": filled_intent.notes,
            "timestamp": filled_intent.updated_at or time.time(),
            "adapter": "paper",
        }


# ---------------------------------------------------------------------------
# CCXT Binance adapter — testnet or mainnet, config-gated
# ---------------------------------------------------------------------------

class BinanceCCXTAdapter(ExchangeAdapter):
    """
    Live execution via CCXT against Binance (testnet or mainnet).

    Only instantiated when:
      - TRADING_MODE=live
      - BINANCE_API_KEY and BINANCE_API_SECRET are set
      - ccxt package is installed

    Testnet base URLs per ccxt Binance driver:
      - Spot testnet: https://testnet.binance.vision/api
    """

    def __init__(self, *, testnet: bool = True):
        try:
            import ccxt
        except ImportError as exc:
            raise RuntimeError(
                "ccxt is not installed. Run: pip install ccxt"
            ) from exc

        api_key = os.getenv("BINANCE_API_KEY", "")
        api_secret = os.getenv("BINANCE_API_SECRET", "")

        if not api_key or not api_secret:
            raise RuntimeError(
                "BINANCE_API_KEY and BINANCE_API_SECRET must be set for live mode."
            )

        self._testnet = testnet
        self._exchange = ccxt.binance(
            {
                "apiKey": api_key,
                "secret": api_secret,
                "enableRateLimit": True,
                "options": {"defaultType": "spot"},
            }
        )

        if testnet:
            self._exchange.set_sandbox_mode(True)
            logger.info("BinanceCCXTAdapter initialized in TESTNET mode")
        else:
            logger.warning("BinanceCCXTAdapter initialized in MAINNET (LIVE) mode")

    @property
    def mode(self) -> str:
        return "testnet" if self._testnet else "mainnet"

    def get_price(self, symbol: str) -> float:
        # ccxt expects 'BTC/USDT' format
        ccxt_symbol = symbol if "/" in symbol else f"{symbol[:-4]}/{symbol[-4:]}"
        ticker = self._exchange.fetch_ticker(ccxt_symbol)
        return float(ticker["last"])

    def get_balance(self, asset: str = "USDT") -> float:
        balances = self._exchange.fetch_balance()
        return float(balances.get("free", {}).get(asset, 0.0))

    def place_order(
        self,
        *,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: Optional[float] = None,
    ) -> Dict:
        ccxt_symbol = symbol if "/" in symbol else f"{symbol[:-4]}/{symbol[-4:]}"
        ccxt_type = order_type.lower()  # 'market' or 'limit'
        ccxt_side = side.lower()        # 'buy' or 'sell'

        params = {}
        if ccxt_type == "limit" and price is not None:
            order = self._exchange.create_order(
                ccxt_symbol, ccxt_type, ccxt_side, quantity, price, params
            )
        else:
            order = self._exchange.create_order(
                ccxt_symbol, "market", ccxt_side, quantity, params=params
            )

        fill_price = order.get("average") or order.get("price") or price or 0.0
        logger.info(
            "CCXT order placed [%s]: %s %s %s qty=%.6f fill=%.4f",
            self.mode, order.get("id"), ccxt_side, ccxt_symbol, quantity, fill_price,
        )

        return {
            "id": order.get("id", ""),
            "symbol": symbol,
            "side": side.upper(),
            "order_type": order_type.upper(),
            "quantity": order.get("filled") or quantity,
            "fill_price": fill_price,
            "status": "FILLED" if order.get("status") == "closed" else order.get("status", "UNKNOWN").upper(),
            "notes": f"CCXT {self.mode} fill",
            "timestamp": order.get("timestamp", time.time() * 1000) / 1000,
            "adapter": self.mode,
        }


# ---------------------------------------------------------------------------
# Factory — call once at startup; returns the correct adapter
# ---------------------------------------------------------------------------

def build_adapter(trading_mode: str, network: str, portfolio, synthetic_price_fn) -> ExchangeAdapter:
    """
    Build and return the appropriate adapter based on environment config.

    Always falls back to PaperAdapter if live prerequisites are not met.
    """
    if trading_mode != "live":
        logger.info("Adapter: PaperAdapter (TRADING_MODE=%s)", trading_mode)
        return PaperAdapter(portfolio, synthetic_price_fn)

    # Live mode requested — validate prerequisites before constructing CCXT adapter
    api_key = os.getenv("BINANCE_API_KEY", "")
    api_secret = os.getenv("BINANCE_API_SECRET", "")

    if not api_key or not api_secret:
        logger.warning(
            "TRADING_MODE=live but credentials missing — falling back to PaperAdapter"
        )
        return PaperAdapter(portfolio, synthetic_price_fn)

    try:
        import ccxt  # noqa: F401
    except ImportError:
        logger.warning(
            "TRADING_MODE=live but ccxt not installed — falling back to PaperAdapter"
        )
        return PaperAdapter(portfolio, synthetic_price_fn)

    testnet = network != "mainnet"
    try:
        adapter = BinanceCCXTAdapter(testnet=testnet)
        logger.info("Adapter: BinanceCCXTAdapter (mode=%s)", adapter.mode)
        return adapter
    except Exception as exc:
        logger.error("Failed to init BinanceCCXTAdapter: %s — falling back to paper", exc)
        return PaperAdapter(portfolio, synthetic_price_fn)
