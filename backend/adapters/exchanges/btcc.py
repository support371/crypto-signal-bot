# backend/adapters/exchanges/btcc.py
"""
PHASE 5 — BTCC exchange adapter (paper and live).

BTCC is the primary exchange scaffold per CLAUDE.md ("BTCC scaffold as
a first-class exchange path"). This adapter normalises BTCC's API into
the shared BaseExchangeAdapter contract.

Paper mode: real BTCC market data for prices, paper ledger for execution.
Live mode:  real BTCC REST API for all operations.
"""

from __future__ import annotations

import hashlib
import hmac
import time
import urllib.parse
from decimal import Decimal
from typing import Optional

import httpx

from backend.adapters.exchanges.base import (
    AdapterAuthError,
    AdapterOrderError,
    AdapterRateLimitError,
    AdapterSymbolNotFoundError,
    AdapterUnavailableError,
    Balance,
    BaseExchangeAdapter,
    ExchangeStatus,
    OhlcvCandle,
    Order,
    Position,
    Ticker,
)

# BTCC interval string mapping
_INTERVAL_MAP = {
    "1m": "60",    "5m": "300",  "15m": "900",
    "1h": "3600",  "4h": "14400", "1d": "86400",
}


class BtccAdapter(BaseExchangeAdapter):
    """
    BTCC adapter supporting paper and live modes.

    BTCC REST API base: https://api.btcc.com (configurable)
    Authentication: HMAC-SHA256 signed requests (live mode only).
    """

    exchange_name = "btcc"

    def __init__(
        self,
        api_key:    Optional[str] = None,
        api_secret: Optional[str] = None,
        paper:      bool = True,
        base_url:   str = "https://api.btcc.com",
        **kwargs: object,
    ) -> None:
        super().__init__(api_key=api_key, api_secret=api_secret, paper=paper)
        self._base_url = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=10.0,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        return self._client

    def _sign(self, params: dict) -> str:
        """Generate HMAC-SHA256 signature for authenticated requests."""
        if not self.api_secret:
            raise AdapterAuthError("BTCC api_secret is required for signed requests.")
        query = urllib.parse.urlencode(sorted(params.items()))
        return hmac.new(
            self.api_secret.encode(),
            query.encode(),
            hashlib.sha256,
        ).hexdigest()

    async def _get_public(self, path: str, params: dict | None = None) -> object:
        client = await self._http()
        try:
            resp = await client.get(path, params=params)
        except httpx.ConnectError as exc:
            raise AdapterUnavailableError(f"BTCC unreachable: {exc}") from exc
        if resp.status_code == 429:
            raise AdapterRateLimitError("BTCC rate limit exceeded.")
        if resp.status_code == 404:
            raise AdapterSymbolNotFoundError(f"BTCC: symbol not found ({path})")
        if not resp.is_success:
            raise AdapterUnavailableError(f"BTCC HTTP {resp.status_code}: {resp.text[:200]}")
        return resp.json()

    async def _get_signed(self, path: str, params: dict) -> object:
        self._assert_live_credentials()
        assert self.api_key
        ts = str(int(time.time() * 1000))
        signed_params = {**params, "timestamp": ts, "api_key": self.api_key}
        sig = self._sign(signed_params)
        signed_params["signature"] = sig
        return await self._get_public(path, signed_params)

    async def _post_signed(self, path: str, body: dict) -> object:
        self._assert_live_credentials()
        assert self.api_key
        client = await self._http()
        ts  = str(int(time.time() * 1000))
        payload = {**body, "timestamp": ts, "api_key": self.api_key}
        sig = self._sign(payload)
        payload["signature"] = sig
        try:
            resp = await client.post(path, json=payload)
        except httpx.ConnectError as exc:
            raise AdapterUnavailableError(f"BTCC unreachable: {exc}") from exc
        if resp.status_code == 401:
            raise AdapterAuthError(f"BTCC authentication failed: {resp.text[:200]}")
        if not resp.is_success:
            data = resp.json()
            raise AdapterOrderError(f"BTCC order error: {data.get('message', str(data))}")
        return resp.json()

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    async def fetch_ticker(self, symbol: str) -> Ticker:
        symbol = self._normalize_symbol(symbol)
        # BTCC ticker endpoint — adjust path to match actual BTCC API spec
        data = await self._get_public(f"/v1/market/ticker", {"symbol": symbol})
        assert isinstance(data, dict)
        price = Decimal(str(data.get("last", data.get("price", 0))))
        bid   = Decimal(str(data.get("best_bid", data.get("bid", price))))
        ask   = Decimal(str(data.get("best_ask", data.get("ask", price))))
        return Ticker(
            symbol=symbol,
            price=price,
            bid=bid,
            ask=ask,
            spread=ask - bid,
            change24h=float(data.get("change_24h", data.get("price_change_pct", 0))),
            volume24h=Decimal(str(data.get("volume_24h", data.get("volume", 0)))),
            timestamp=int(time.time()),
        )

    async def fetch_ohlcv(
        self,
        symbol:   str,
        interval: str = "1h",
        limit:    int = 24,
    ) -> list[OhlcvCandle]:
        symbol   = self._normalize_symbol(symbol)
        btcc_int = _INTERVAL_MAP.get(interval, "3600")
        data = await self._get_public(
            "/v1/market/klines",
            {"symbol": symbol, "period": btcc_int, "limit": limit},
        )
        candles_raw = data if isinstance(data, list) else data.get("data", [])
        return [
            OhlcvCandle(
                time=int(c[0]) if c[0] > 1e10 else int(c[0]),  # handle ms or s
                open=Decimal(str(c[1])),
                high=Decimal(str(c[2])),
                low=Decimal(str(c[3])),
                close=Decimal(str(c[4])),
                volume=Decimal(str(c[5])),
            )
            for c in candles_raw
        ]

    # ------------------------------------------------------------------
    # Account
    # ------------------------------------------------------------------

    async def fetch_balance(self) -> list[Balance]:
        if self.paper:
            return []  # Paper balance owned by reconciliation service
        data = await self._get_signed("/v1/account/balance", {})
        assert isinstance(data, (dict, list))
        items = data if isinstance(data, list) else data.get("balances", [])
        return [
            Balance(
                asset=b["asset"].upper(),
                free=Decimal(str(b.get("free", b.get("available", 0)))),
                locked=Decimal(str(b.get("locked", b.get("frozen", 0)))),
            )
            for b in items
            if Decimal(str(b.get("free", 0))) > 0 or Decimal(str(b.get("locked", 0))) > 0
        ]

    async def fetch_positions(self) -> list[Position]:
        if self.paper:
            return []
        data = await self._get_signed("/v1/account/positions", {})
        assert isinstance(data, (dict, list))
        items = data if isinstance(data, list) else data.get("positions", [])
        return [
            Position(
                symbol=p["symbol"].upper(),
                side=p.get("side", "LONG").upper(),
                quantity=Decimal(str(p.get("size", p.get("quantity", 0)))),
                entry_price=Decimal(str(p.get("entry_price", 0))),
                mark_price=Decimal(str(p.get("mark_price", 0))),
                unrealized_pnl=Decimal(str(p.get("unrealized_pnl", 0))),
            )
            for p in items
            if Decimal(str(p.get("size", p.get("quantity", 0)))) != 0
        ]

    # ------------------------------------------------------------------
    # Order management
    # ------------------------------------------------------------------

    async def create_order(
        self,
        symbol:     str,
        side:       str,
        order_type: str,
        quantity:   Decimal,
        price:      Optional[Decimal] = None,
    ) -> Order:
        symbol = self._normalize_symbol(symbol)
        now    = int(time.time())

        if self.paper:
            ticker     = await self.fetch_ticker(symbol)
            fill_price = ticker.price if order_type.upper() == "MARKET" else (price or ticker.price)
            return Order(
                id=f"paper-btcc-{now}",
                symbol=symbol,
                side=side.upper(),
                order_type=order_type.upper(),
                quantity=quantity,
                price=price,
                fill_price=fill_price,
                filled_qty=quantity,
                status="FILLED",
                created_at=now,
                updated_at=now,
            )

        self._assert_live_credentials()
        body: dict = {
            "symbol":    symbol,
            "side":      side.upper(),
            "type":      order_type.upper(),
            "quantity":  str(quantity),
        }
        if price and order_type.upper() == "LIMIT":
            body["price"] = str(price)

        data = await self._post_signed("/v1/order/create", body)
        assert isinstance(data, dict)
        return Order(
            id=str(data.get("order_id", f"btcc-{now}")),
            symbol=symbol,
            side=side.upper(),
            order_type=order_type.upper(),
            quantity=quantity,
            price=price,
            fill_price=Decimal(str(data["fill_price"])) if data.get("fill_price") else None,
            filled_qty=Decimal(str(data.get("filled_qty", 0))),
            status=data.get("status", "PENDING").upper(),
            created_at=now,
            updated_at=now,
            exchange_order_id=str(data.get("order_id")),
        )

    async def cancel_order(self, symbol: str, order_id: str) -> Order:
        if self.paper:
            now = int(time.time())
            return Order(
                id=order_id, symbol=self._normalize_symbol(symbol),
                side="BUY", order_type="MARKET", quantity=Decimal("0"),
                price=None, fill_price=None, status="CANCELLED",
                created_at=now, updated_at=now,
            )
        data = await self._post_signed("/v1/order/cancel", {"order_id": order_id})
        assert isinstance(data, dict)
        now = int(time.time())
        return Order(
            id=order_id, symbol=self._normalize_symbol(symbol),
            side=data.get("side", "BUY").upper(),
            order_type=data.get("type", "MARKET").upper(),
            quantity=Decimal(str(data.get("quantity", 0))),
            price=None, fill_price=None, status="CANCELLED",
            created_at=now, updated_at=now,
        )

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        self._assert_live_credentials()
        data = await self._get_signed("/v1/order/detail", {"order_id": order_id})
        assert isinstance(data, dict)
        now = int(time.time())
        return Order(
            id=order_id,
            symbol=self._normalize_symbol(symbol),
            side=data.get("side", "BUY").upper(),
            order_type=data.get("type", "MARKET").upper(),
            quantity=Decimal(str(data.get("quantity", 0))),
            price=Decimal(str(data["price"])) if data.get("price") else None,
            fill_price=Decimal(str(data["fill_price"])) if data.get("fill_price") else None,
            filled_qty=Decimal(str(data.get("filled_qty", 0))),
            status=data.get("status", "PENDING").upper(),
            created_at=int(data.get("created_at", now)),
            updated_at=int(data.get("updated_at", now)),
            exchange_order_id=order_id,
        )

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    async def exchange_status(self) -> ExchangeStatus:
        try:
            await self._get_public("/v1/market/ping")
            connected = True
            error = None
        except Exception as exc:
            connected = False
            error = str(exc)

        return ExchangeStatus(
            connected=connected,
            mode="paper" if self.paper else "live",
            exchange_name=self.exchange_name,
            market_data_available=connected,
            market_data_mode="live_public_paper" if self.paper else "live",
            connection_state="connected" if connected else "offline",
            fallback_active=False,
            stale=False,
            source=self._base_url,
            error=error,
        )
