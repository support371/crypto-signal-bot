# backend/adapters/exchanges/bitget.py
"""
PHASE 5 — Bitget exchange adapter (paper and live).

Bitget requires an additional passphrase for authentication.
All live authenticated endpoints use HMAC-SHA256 + base64 signature.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time
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

_INTERVAL_MAP = {
    "1m": "1min", "5m": "5min", "15m": "15min",
    "1h": "1H",   "4h": "4H",   "1d": "1D",
}


class BitgetAdapter(BaseExchangeAdapter):
    """
    Bitget adapter supporting paper and live modes.

    Bitget API docs: https://www.bitget.com/api-doc/
    Auth: ACCESS-KEY + ACCESS-SIGN (HMAC-SHA256, base64) + ACCESS-PASSPHRASE + ACCESS-TIMESTAMP
    """

    exchange_name = "bitget"

    def __init__(
        self,
        api_key:    Optional[str] = None,
        api_secret: Optional[str] = None,
        passphrase: Optional[str] = None,
        paper:      bool = True,
        base_url:   str = "https://api.bitget.com",
        **kwargs: object,
    ) -> None:
        super().__init__(api_key=api_key, api_secret=api_secret, paper=paper)
        self._passphrase = passphrase
        self._base_url   = base_url.rstrip("/")
        self._client: Optional[httpx.AsyncClient] = None

    def _assert_live_credentials(self) -> None:
        """Override to also check for passphrase."""
        if not self.paper:
            if not self.api_key or not self.api_secret:
                raise AdapterAuthError("Bitget: api_key and api_secret required in live mode.")
            if not self._passphrase:
                raise AdapterAuthError("Bitget: passphrase is required in live mode.")

    def _sign(self, timestamp: str, method: str, path: str, body: str = "") -> str:
        """Generate Bitget HMAC-SHA256 signature."""
        if not self.api_secret:
            raise AdapterAuthError("Bitget api_secret is required.")
        prehash = f"{timestamp}{method.upper()}{path}{body}"
        sig = hmac.new(
            self.api_secret.encode(),
            prehash.encode(),
            hashlib.sha256,
        ).digest()
        return base64.b64encode(sig).decode()

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=10.0,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
            )
        return self._client

    async def _get_public(self, path: str, params: dict | None = None) -> object:
        client = await self._http()
        try:
            resp = await client.get(path, params=params)
        except httpx.ConnectError as exc:
            raise AdapterUnavailableError(f"Bitget unreachable: {exc}") from exc
        if resp.status_code == 429:
            raise AdapterRateLimitError("Bitget rate limit exceeded.")
        if not resp.is_success:
            raise AdapterUnavailableError(f"Bitget HTTP {resp.status_code}")
        data = resp.json()
        # Bitget wraps responses in {code, msg, data}
        if isinstance(data, dict) and data.get("code") not in (None, "00000", 0):
            msg = data.get("msg", str(data))
            if "symbol" in msg.lower() or "not found" in msg.lower():
                raise AdapterSymbolNotFoundError(f"Bitget: {msg}")
            raise AdapterUnavailableError(f"Bitget API error: {msg}")
        return data.get("data", data) if isinstance(data, dict) and "data" in data else data

    async def _get_signed(self, path: str, params: dict | None = None) -> object:
        self._assert_live_credentials()
        assert self.api_key and self._passphrase
        ts  = str(int(time.time() * 1000))
        sig = self._sign(ts, "GET", path)
        client = await self._http()
        try:
            resp = await client.get(
                path, params=params,
                headers={
                    "ACCESS-KEY": self.api_key,
                    "ACCESS-SIGN": sig,
                    "ACCESS-PASSPHRASE": self._passphrase,
                    "ACCESS-TIMESTAMP": ts,
                    "locale": "en-US",
                }
            )
        except httpx.ConnectError as exc:
            raise AdapterUnavailableError(f"Bitget unreachable: {exc}") from exc
        if resp.status_code == 401:
            raise AdapterAuthError(f"Bitget auth failed: {resp.text[:200]}")
        data = resp.json()
        if isinstance(data, dict) and data.get("code") not in (None, "00000", 0):
            raise AdapterOrderError(f"Bitget error: {data.get('msg', str(data))}")
        return data.get("data", data) if isinstance(data, dict) and "data" in data else data

    async def _post_signed(self, path: str, body: dict) -> object:
        self._assert_live_credentials()
        assert self.api_key and self._passphrase
        import json
        ts       = str(int(time.time() * 1000))
        body_str = json.dumps(body)
        sig      = self._sign(ts, "POST", path, body_str)
        client   = await self._http()
        try:
            resp = await client.post(
                path, content=body_str,
                headers={
                    "ACCESS-KEY": self.api_key,
                    "ACCESS-SIGN": sig,
                    "ACCESS-PASSPHRASE": self._passphrase,
                    "ACCESS-TIMESTAMP": ts,
                    "locale": "en-US",
                }
            )
        except httpx.ConnectError as exc:
            raise AdapterUnavailableError(f"Bitget unreachable: {exc}") from exc
        if resp.status_code == 401:
            raise AdapterAuthError(f"Bitget auth failed: {resp.text[:200]}")
        data = resp.json()
        if isinstance(data, dict) and data.get("code") not in (None, "00000", 0):
            raise AdapterOrderError(f"Bitget order error: {data.get('msg', str(data))}")
        return data.get("data", data) if isinstance(data, dict) and "data" in data else data

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    async def fetch_ticker(self, symbol: str) -> Ticker:
        symbol = self._normalize_symbol(symbol)
        data   = await self._get_public("/api/v2/spot/market/tickers", {"symbol": symbol})
        t      = data[0] if isinstance(data, list) else data
        price  = Decimal(str(t.get("lastPr", t.get("close", 0))))
        bid    = Decimal(str(t.get("bidPr", price)))
        ask    = Decimal(str(t.get("askPr", price)))
        return Ticker(
            symbol=symbol,
            price=price,
            bid=bid,
            ask=ask,
            spread=ask - bid,
            change24h=float(t.get("change24h", t.get("changeUtc24h", 0))),
            volume24h=Decimal(str(t.get("baseVolume", t.get("volume24h", 0)))),
            timestamp=int(time.time()),
        )

    async def fetch_ohlcv(
        self,
        symbol:   str,
        interval: str = "1h",
        limit:    int = 24,
    ) -> list[OhlcvCandle]:
        symbol   = self._normalize_symbol(symbol)
        granularity = _INTERVAL_MAP.get(interval, "1H")
        data = await self._get_public(
            "/api/v2/spot/market/candles",
            {"symbol": symbol, "granularity": granularity, "limit": str(limit)},
        )
        candles = data if isinstance(data, list) else []
        return [
            OhlcvCandle(
                time=int(c[0]) // 1000 if int(c[0]) > 1e10 else int(c[0]),
                open=Decimal(str(c[1])),
                high=Decimal(str(c[2])),
                low=Decimal(str(c[3])),
                close=Decimal(str(c[4])),
                volume=Decimal(str(c[5])),
            )
            for c in candles
        ]

    async def fetch_balance(self) -> list[Balance]:
        if self.paper:
            return []
        data = await self._get_signed("/api/v2/spot/account/assets")
        items = data if isinstance(data, list) else []
        return [
            Balance(
                asset=b["coin"].upper(),
                free=Decimal(str(b.get("available", 0))),
                locked=Decimal(str(b.get("frozen", 0))),
            )
            for b in items
            if Decimal(str(b.get("available", 0))) > 0 or Decimal(str(b.get("frozen", 0))) > 0
        ]

    async def fetch_positions(self) -> list[Position]:
        if self.paper:
            return []
        data  = await self._get_signed("/api/v2/mix/position/all-position-history")
        items = data if isinstance(data, list) else []
        return [
            Position(
                symbol=p["symbol"].upper(),
                side="LONG" if p.get("holdSide") == "long" else "SHORT",
                quantity=Decimal(str(p.get("openAvgPrice", 0))),
                entry_price=Decimal(str(p.get("openAvgPrice", 0))),
                mark_price=Decimal(str(p.get("markPrice", 0))),
                unrealized_pnl=Decimal(str(p.get("unrealizedPL", 0))),
            )
            for p in items
        ]

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
                id=f"paper-bitget-{now}", symbol=symbol,
                side=side.upper(), order_type=order_type.upper(),
                quantity=quantity, price=price, fill_price=fill_price,
                filled_qty=quantity, status="FILLED",
                created_at=now, updated_at=now,
            )

        self._assert_live_credentials()
        body: dict = {
            "symbol":    symbol,
            "side":      side.lower(),
            "orderType": order_type.lower(),
            "size":      str(quantity),
            "force":     "gtc",
        }
        if price and order_type.upper() == "LIMIT":
            body["price"] = str(price)

        data = await self._post_signed("/api/v2/spot/trade/place-order", body)
        assert isinstance(data, dict)
        oid = str(data.get("orderId", f"bitget-{now}"))
        return Order(
            id=oid, symbol=symbol, side=side.upper(),
            order_type=order_type.upper(), quantity=quantity, price=price,
            fill_price=None, filled_qty=Decimal("0"),
            status="PENDING", created_at=now, updated_at=now,
            exchange_order_id=oid,
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
        now  = int(time.time())
        data = await self._post_signed(
            "/api/v2/spot/trade/cancel-order",
            {"symbol": self._normalize_symbol(symbol), "orderId": order_id},
        )
        assert isinstance(data, dict)
        return Order(
            id=order_id, symbol=self._normalize_symbol(symbol),
            side="BUY", order_type="MARKET", quantity=Decimal("0"),
            price=None, fill_price=None, status="CANCELLED",
            created_at=now, updated_at=now,
        )

    async def fetch_order(self, symbol: str, order_id: str) -> Order:
        self._assert_live_credentials()
        data = await self._get_signed(
            "/api/v2/spot/trade/orderInfo",
            {"symbol": self._normalize_symbol(symbol), "orderId": order_id},
        )
        assert isinstance(data, dict)
        now = int(time.time())
        return Order(
            id=order_id, symbol=self._normalize_symbol(symbol),
            side=data.get("side", "BUY").upper(),
            order_type=data.get("orderType", "MARKET").upper(),
            quantity=Decimal(str(data.get("size", 0))),
            price=Decimal(str(data["price"])) if data.get("price") else None,
            fill_price=Decimal(str(data["fillPrice"])) if data.get("fillPrice") else None,
            filled_qty=Decimal(str(data.get("fillSize", 0))),
            status=data.get("status", "PENDING").upper(),
            created_at=int(data.get("cTime", now)),
            updated_at=int(data.get("uTime", now)),
            exchange_order_id=order_id,
        )

    async def exchange_status(self) -> ExchangeStatus:
        try:
            await self._get_public("/api/v2/spot/market/tickers", {"symbol": "BTCUSDT"})
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
