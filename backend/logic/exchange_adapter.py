"""
Exchange adapter abstraction.

Provides a unified interface for paper execution and authenticated exchange
connections selected through environment configuration.
"""

from __future__ import annotations

import logging
import os
import time
from abc import ABC, abstractmethod
from typing import Dict, Optional

logger = logging.getLogger("backend.exchange_adapter")

SUPPORTED_EXCHANGES = {"binance", "bitget", "btcc"}
_CREDENTIAL_ENV_MAP = {
    "binance": ("BINANCE_API_KEY", "BINANCE_API_SECRET", None),
    "bitget": ("BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE"),
    "btcc": ("BTCC_API_KEY", "BTCC_API_SECRET", None),
}
_QUOTE_ASSETS = {"USDT", "USDC", "BUSD", "BTC", "ETH", "BNB"}


def normalize_exchange_name(exchange: Optional[str]) -> str:
    normalized = (exchange or "binance").strip().lower()
    return normalized if normalized in SUPPORTED_EXCHANGES else "binance"


def get_required_credential_envs(exchange: Optional[str]) -> tuple[str, ...]:
    key_env, secret_env, extra_env = _CREDENTIAL_ENV_MAP[normalize_exchange_name(exchange)]
    result = [key_env, secret_env]
    if extra_env:
        result.append(extra_env)
    return tuple(result)


def credentials_present(exchange: Optional[str]) -> bool:
    return all(os.getenv(env_name, "") for env_name in get_required_credential_envs(exchange))


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
        """Place an order and return a normalized order payload."""

    @abstractmethod
    def get_balance(self, asset: str = "USDT") -> float:
        """Return free balance for the given asset."""

    @abstractmethod
    def get_price(self, symbol: str) -> float:
        """Return current market price for symbol."""

    @abstractmethod
    def get_order_status(self, order_id: str, symbol: str) -> Dict:
        """Fetch a normalized order-status payload."""

    @abstractmethod
    def cancel_order(self, order_id: str, symbol: str) -> Dict:
        """Cancel an order and return a normalized order payload."""

    @abstractmethod
    def reconcile(self) -> Dict:
        """Return a reconciliation snapshot for balances and open orders."""

    @abstractmethod
    def liquidate_all_positions(self) -> Dict:
        """Attempt to liquidate all non-quote balances."""

    @property
    @abstractmethod
    def mode(self) -> str:
        """Human-readable adapter mode label, e.g. 'paper', 'testnet', 'mainnet'."""

    @property
    @abstractmethod
    def exchange(self) -> str:
        """Selected exchange identifier."""


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

    @property
    def exchange(self) -> str:
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
        from backend.models.execution_intent import ExecutionIntent, OrderType, Side

        normalized_symbol = symbol.upper().replace("/", "")
        intent = ExecutionIntent(
            symbol=normalized_symbol,
            side=Side(side.upper()),
            order_type=OrderType(order_type.upper()),
            quantity=quantity,
            price=price,
            mode="paper",
        )
        market_price = self._synthetic_price(intent.symbol)
        filled_intent = simulate_fill(intent, self._portfolio, market_price)
        return self._normalize_paper_intent(filled_intent, quantity)

    def get_order_status(self, order_id: str, symbol: str) -> Dict:
        for intent in [*self._portfolio.open_orders, *self._portfolio.filled_orders]:
            if intent.id == order_id:
                return self._normalize_paper_intent(intent, intent.quantity)
        return {
            "id": order_id,
            "symbol": symbol.upper().replace("/", ""),
            "status": "UNKNOWN",
            "adapter": "paper",
        }

    def cancel_order(self, order_id: str, symbol: str) -> Dict:
        for intent in list(self._portfolio.open_orders):
            if intent.id == order_id:
                self._portfolio.open_orders.remove(intent)
                intent.status = "CANCELLED"
                return self._normalize_paper_intent(intent, intent.quantity)
        return {
            "id": order_id,
            "symbol": symbol.upper().replace("/", ""),
            "status": "CANCELLED",
            "adapter": "paper",
            "notes": "Paper adapter has no open exchange-side order book",
        }

    def reconcile(self) -> Dict:
        return {
            "exchange": self.exchange,
            "mode": self.mode,
            "balances": self._portfolio.get_all_balances(),
            "positions": self._portfolio.get_positions(),
            "open_orders": [
                self._normalize_paper_intent(intent, intent.quantity)
                for intent in self._portfolio.open_orders
            ],
        }

    def liquidate_all_positions(self) -> Dict:
        results = []
        for asset, amount in list(self._portfolio.balances.items()):
            if asset in _QUOTE_ASSETS or amount <= 0:
                continue
            results.append(
                self.place_order(
                    symbol=f"{asset}USDT",
                    side="SELL",
                    order_type="MARKET",
                    quantity=amount,
                )
            )
        return {
            "exchange": self.exchange,
            "mode": self.mode,
            "orders": results,
            "liquidated_positions": len(results),
        }

    def _normalize_paper_intent(self, intent, default_quantity: float) -> Dict:
        status_value = getattr(intent.status, "value", intent.status)
        side_value = getattr(intent.side, "value", intent.side)
        order_type_value = getattr(intent.order_type, "value", intent.order_type)
        return {
            "id": intent.id,
            "symbol": intent.symbol,
            "side": side_value,
            "order_type": order_type_value,
            "quantity": intent.fill_quantity or default_quantity,
            "fill_price": intent.fill_price,
            "status": status_value,
            "notes": intent.notes,
            "timestamp": getattr(intent, "updated_at", time.time()),
            "adapter": "paper",
            "exchange": self.exchange,
        }


class CCXTSpotAdapter(ExchangeAdapter):
    """Authenticated exchange execution through ccxt."""

    def __init__(self, *, exchange_id: str, testnet: bool = True):
        exchange_id = normalize_exchange_name(exchange_id)
        try:
            import ccxt
        except ImportError as exc:
            raise RuntimeError("ccxt is not installed. Run: pip install ccxt") from exc

        exchange_class = getattr(ccxt, exchange_id, None)
        if exchange_class is None:
            raise RuntimeError(f"ccxt does not expose exchange '{exchange_id}'")

        self._exchange_id = exchange_id
        self._testnet = testnet
        key_env, secret_env, extra_env = _CREDENTIAL_ENV_MAP[exchange_id]
        api_key = os.getenv(key_env, "")
        api_secret = os.getenv(secret_env, "")
        extra_value = os.getenv(extra_env, "") if extra_env else ""
        if not api_key or not api_secret or (extra_env and not extra_value):
            raise RuntimeError(
                f"{', '.join(get_required_credential_envs(exchange_id))} must be set for live mode."
            )

        config = {
            "apiKey": api_key,
            "secret": api_secret,
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        }
        if extra_env:
            config["password"] = extra_value

        self._exchange = exchange_class(config)
        self._configure_exchange()

    @property
    def mode(self) -> str:
        return "testnet" if self._testnet else "mainnet"

    @property
    def exchange(self) -> str:
        return self._exchange_id

    def get_price(self, symbol: str) -> float:
        ticker = self._exchange.fetch_ticker(_ccxt_symbol(symbol))
        return float(ticker.get("last") or ticker.get("close") or 0.0)

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
        ccxt_symbol = _ccxt_symbol(symbol)
        ccxt_type = order_type.lower()
        ccxt_side = side.lower()
        if ccxt_type == "limit" and price is not None:
            order = self._exchange.create_order(ccxt_symbol, ccxt_type, ccxt_side, quantity, price)
        else:
            order = self._exchange.create_order(ccxt_symbol, "market", ccxt_side, quantity)
        return self._normalize_order(order, symbol=symbol, side=side, order_type=order_type, quantity=quantity, price=price)

    def get_order_status(self, order_id: str, symbol: str) -> Dict:
        order = self._exchange.fetch_order(order_id, _ccxt_symbol(symbol))
        return self._normalize_order(order, symbol=symbol)

    def cancel_order(self, order_id: str, symbol: str) -> Dict:
        order = self._exchange.cancel_order(order_id, _ccxt_symbol(symbol))
        return self._normalize_order(order, symbol=symbol)

    def reconcile(self) -> Dict:
        balances = self._exchange.fetch_balance()
        open_orders = []
        try:
            open_orders = self._exchange.fetch_open_orders()
        except Exception as exc:
            logger.warning("Open-order reconciliation failed for %s: %s", self.exchange, exc)
        return {
            "exchange": self.exchange,
            "mode": self.mode,
            "balances": balances.get("free", {}),
            "open_orders": [self._normalize_order(order) for order in open_orders],
        }

    def liquidate_all_positions(self) -> Dict:
        self._exchange.load_markets()
        balances = self._exchange.fetch_balance().get("free", {})
        results = []
        for asset, amount in balances.items():
            try:
                quantity = float(amount)
            except (TypeError, ValueError):
                continue
            if asset in _QUOTE_ASSETS or quantity <= 0:
                continue
            symbol = f"{asset}/USDT"
            if symbol not in self._exchange.markets:
                continue
            try:
                order = self._exchange.create_order(symbol, "market", "sell", quantity)
                results.append(self._normalize_order(order, symbol=symbol))
            except Exception as exc:
                results.append(
                    {
                        "symbol": symbol,
                        "quantity": quantity,
                        "status": "FAILED",
                        "notes": str(exc),
                        "exchange": self.exchange,
                        "adapter": self.mode,
                    }
                )
        return {
            "exchange": self.exchange,
            "mode": self.mode,
            "orders": results,
            "liquidated_positions": len(results),
        }

    def _configure_exchange(self) -> None:
        if self._exchange_id == "binance":
            if self._testnet:
                self._exchange.set_sandbox_mode(True)
                logger.info("Binance adapter initialized in TESTNET mode")
            else:
                logger.warning("Binance adapter initialized in MAINNET mode")
            return

        if self._exchange_id == "bitget":
            if self._testnet:
                headers = dict(getattr(self._exchange, "headers", {}) or {})
                headers["paptrading"] = "1"
                self._exchange.headers = headers
                logger.info("Bitget adapter initialized in demo/testnet mode")
            else:
                logger.warning("Bitget adapter initialized in MAINNET mode")
            return

        if self._exchange_id == "btcc":
            if self._testnet:
                raise RuntimeError(
                    "BTCC testnet/demo trading is not supported by the configured adapter. "
                    "Keep EXCHANGE=btcc for public market-data use only until authenticated demo "
                    "credentials and sandbox support are available."
                )
            logger.warning("BTCC adapter initialized in MAINNET mode")

    def _normalize_order(
        self,
        order: Dict,
        *,
        symbol: Optional[str] = None,
        side: Optional[str] = None,
        order_type: Optional[str] = None,
        quantity: Optional[float] = None,
        price: Optional[float] = None,
    ) -> Dict:
        symbol_value = str(order.get("symbol") or symbol or "").replace("/", "").upper()
        raw_status = str(order.get("status", "unknown")).lower()
        status_map = {
            "open": "SUBMITTED",
            "closed": "FILLED",
            "canceled": "CANCELLED",
            "cancelled": "CANCELLED",
            "rejected": "FAILED",
            "expired": "FAILED",
        }
        fill_price = order.get("average") or order.get("price") or price or 0.0
        return {
            "id": order.get("id", ""),
            "symbol": symbol_value,
            "side": str(order.get("side") or side or "").upper(),
            "order_type": str(order.get("type") or order_type or "").upper(),
            "quantity": order.get("filled") or order.get("amount") or quantity or 0.0,
            "fill_price": float(fill_price or 0.0),
            "status": status_map.get(raw_status, raw_status.upper()),
            "notes": f"CCXT {self.exchange} {self.mode}",
            "timestamp": float(order.get("timestamp", time.time() * 1000)) / 1000,
            "adapter": self.mode,
            "exchange": self.exchange,
            "raw_status": raw_status,
        }


def _ccxt_symbol(symbol: str) -> str:
    normalized = symbol.upper().replace("-", "/")
    if "/" in normalized:
        return normalized
    for quote in sorted(_QUOTE_ASSETS, key=len, reverse=True):
        if normalized.endswith(quote):
            return f"{normalized[:-len(quote)]}/{quote}"
    return normalized


def build_adapter(
    trading_mode: str,
    network: str,
    portfolio,
    synthetic_price_fn,
    exchange: Optional[str] = None,
) -> ExchangeAdapter:
    """
    Build and return the appropriate adapter based on environment config.

    Always falls back to PaperAdapter if live prerequisites are not met.
    """
    selected_exchange = normalize_exchange_name(exchange or os.getenv("EXCHANGE", "binance"))
    if trading_mode != "live":
        logger.info("Adapter: PaperAdapter (TRADING_MODE=%s)", trading_mode)
        return PaperAdapter(portfolio, synthetic_price_fn)

    if not credentials_present(selected_exchange):
        logger.warning(
            "TRADING_MODE=live but %s credentials are missing — falling back to PaperAdapter",
            selected_exchange,
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
        adapter = CCXTSpotAdapter(exchange_id=selected_exchange, testnet=testnet)
        logger.info("Adapter: %s (exchange=%s mode=%s)", adapter.__class__.__name__, adapter.exchange, adapter.mode)
        return adapter
    except Exception as exc:
        logger.error(
            "Failed to init %s adapter: %s — falling back to paper",
            selected_exchange,
            exc,
        )
        return PaperAdapter(portfolio, synthetic_price_fn)
