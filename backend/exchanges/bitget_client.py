"""
Bitget exchange client with HMAC-SHA256 request signing.

Supports spot trading: market/limit orders, balance queries, withdrawals.
Uses Bitget V2 REST API.

Docs: https://www.bitget.com/api-doc/spot/
"""

import hashlib
import hmac
import base64
import time
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone

import httpx

from backend.exchanges.base_client import BaseExchangeClient

logger = logging.getLogger("bitget_client")

# Bitget V2 API base URLs
_BASE_URL_LIVE = "https://api.bitget.com"
_BASE_URL_DEMO = "https://api.bitget.com"  # Bitget uses same URL, demo mode via header

# Bitget spot order side mapping
_SIDE_MAP = {"BUY": "buy", "SELL": "sell"}
_ORDER_TYPE_MAP = {"MARKET": "market", "LIMIT": "limit"}
_TIF_MAP = {"GTC": "gtc", "IOC": "ioc", "FOK": "fok"}


class BitgetClient(BaseExchangeClient):
    """Bitget spot exchange client with HMAC-SHA256 signing."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        passphrase: str = "",
        testnet: bool = True,
        timeout: float = 10.0,
    ):
        super().__init__(api_key, api_secret, passphrase, testnet)
        self.base_url = _BASE_URL_DEMO if testnet else _BASE_URL_LIVE
        self.timeout = timeout
        self._client = httpx.Client(timeout=timeout)

    @property
    def name(self) -> str:
        return "bitget"

    # ------------------------------------------------------------------
    # Request signing (Bitget V2 HMAC-SHA256)
    # ------------------------------------------------------------------

    def _timestamp(self) -> str:
        """ISO 8601 UTC timestamp for Bitget signature."""
        return str(int(time.time() * 1000))

    def _sign(self, timestamp: str, method: str, path: str, body: str = "") -> str:
        """
        Create HMAC-SHA256 signature.

        Prehash string: timestamp + method(UPPER) + requestPath + body
        """
        prehash = timestamp + method.upper() + path + body
        mac = hmac.new(
            self.api_secret.encode("utf-8"),
            prehash.encode("utf-8"),
            hashlib.sha256,
        )
        return base64.b64encode(mac.digest()).decode("utf-8")

    def _headers(self, method: str, path: str, body: str = "") -> Dict[str, str]:
        """Build authenticated request headers."""
        ts = self._timestamp()
        signature = self._sign(ts, method, path, body)
        headers = {
            "ACCESS-KEY": self.api_key,
            "ACCESS-SIGN": signature,
            "ACCESS-TIMESTAMP": ts,
            "ACCESS-PASSPHRASE": self.passphrase,
            "Content-Type": "application/json",
            "locale": "en-US",
        }
        if self.testnet:
            headers["X-SIMULATED-TRADING"] = "1"
        return headers

    def _request(
        self, method: str, path: str, params: Optional[Dict] = None,
        body: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Execute authenticated API request with error handling."""
        url = self.base_url + path

        body_str = ""
        if body:
            import json
            body_str = json.dumps(body)

        # For GET with params, append query string to path for signing
        sign_path = path
        if params:
            qs = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
            sign_path = path + "?" + qs

        headers = self._headers(method, sign_path, body_str if method != "GET" else "")

        try:
            if method == "GET":
                resp = self._client.get(url, params=params, headers=headers)
            elif method == "POST":
                resp = self._client.post(url, content=body_str, headers=headers)
            elif method == "DELETE":
                resp = self._client.request("DELETE", url, content=body_str, headers=headers)
            else:
                raise ValueError(f"Unsupported method: {method}")

            data = resp.json()

            if resp.status_code != 200 or data.get("code") != "00000":
                error_msg = data.get("msg", f"HTTP {resp.status_code}")
                logger.error("Bitget API error: %s (code=%s)", error_msg, data.get("code"))
                raise BitgetAPIError(error_msg, data.get("code", "UNKNOWN"))

            return data.get("data", {})

        except httpx.TimeoutException:
            logger.error("Bitget API timeout: %s %s", method, path)
            raise BitgetAPIError("Request timeout", "TIMEOUT")
        except httpx.RequestError as e:
            logger.error("Bitget API network error: %s", e)
            raise BitgetAPIError(f"Network error: {e}", "NETWORK")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_server_time(self) -> float:
        """Get Bitget server time (ms)."""
        data = self._request("GET", "/api/v2/public/time")
        return float(data.get("serverTime", time.time() * 1000))

    def get_ticker(self, symbol: str) -> Dict[str, Any]:
        """Get spot ticker for a symbol (e.g., 'BTCUSDT')."""
        data = self._request("GET", "/api/v2/spot/market/tickers", params={"symbol": symbol})

        if isinstance(data, list) and len(data) > 0:
            t = data[0]
        elif isinstance(data, dict):
            t = data
        else:
            raise BitgetAPIError(f"No ticker data for {symbol}", "NO_DATA")

        return {
            "symbol": t.get("symbol", symbol),
            "last": float(t.get("lastPr", 0)),
            "bid": float(t.get("bidPr", 0)),
            "ask": float(t.get("askPr", 0)),
            "volume_24h": float(t.get("baseVolume", 0)),
            "timestamp": time.time(),
        }

    # ------------------------------------------------------------------
    # Account API (authenticated)
    # ------------------------------------------------------------------

    def get_balance(self) -> Dict[str, float]:
        """Get spot account balances."""
        data = self._request("GET", "/api/v2/spot/account/assets")

        balances = {}
        if isinstance(data, list):
            for asset in data:
                coin = asset.get("coin", "")
                available = float(asset.get("available", 0))
                if available > 0:
                    balances[coin] = available
        return balances

    # ------------------------------------------------------------------
    # Trading API
    # ------------------------------------------------------------------

    def place_order(
        self,
        symbol: str,
        side: str,
        order_type: str,
        quantity: float,
        price: Optional[float] = None,
        time_in_force: str = "GTC",
    ) -> Dict[str, Any]:
        """
        Place a spot order on Bitget.

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            side: "BUY" or "SELL"
            order_type: "MARKET" or "LIMIT"
            quantity: Order quantity in base asset
            price: Limit price (required for LIMIT orders)
            time_in_force: "GTC", "IOC", or "FOK"
        """
        body = {
            "symbol": symbol,
            "side": _SIDE_MAP.get(side.upper(), "buy"),
            "orderType": _ORDER_TYPE_MAP.get(order_type.upper(), "market"),
            "size": str(quantity),
            "force": _TIF_MAP.get(time_in_force.upper(), "gtc"),
        }

        if order_type.upper() == "LIMIT" and price is not None:
            body["price"] = str(price)

        data = self._request("POST", "/api/v2/spot/trade/place-order", body=body)

        order_id = data.get("orderId", data.get("clientOid", ""))
        logger.info("Bitget order placed: %s %s %s qty=%s -> order_id=%s",
                     side, order_type, symbol, quantity, order_id)

        return {
            "order_id": str(order_id),
            "status": "SUBMITTED",
            "fill_price": None,
            "fill_quantity": None,
            "timestamp": time.time(),
        }

    def cancel_order(self, symbol: str, order_id: str) -> Dict[str, Any]:
        """Cancel an open order."""
        body = {"symbol": symbol, "orderId": order_id}
        self._request("POST", "/api/v2/spot/trade/cancel-order", body=body)
        logger.info("Bitget order cancelled: %s", order_id)
        return {
            "order_id": order_id,
            "status": "CANCELLED",
            "timestamp": time.time(),
        }

    def get_order(self, symbol: str, order_id: str) -> Dict[str, Any]:
        """Get order details by ID."""
        data = self._request(
            "GET", "/api/v2/spot/trade/orderInfo",
            params={"symbol": symbol, "orderId": order_id},
        )

        if isinstance(data, list) and len(data) > 0:
            o = data[0]
        elif isinstance(data, dict):
            o = data
        else:
            raise BitgetAPIError(f"Order not found: {order_id}", "NOT_FOUND")

        # Map Bitget status to our status
        status_map = {
            "live": "SUBMITTED",
            "partially_filled": "PARTIALLY_FILLED",
            "filled": "FILLED",
            "cancelled": "CANCELLED",
        }
        raw_status = o.get("status", "").lower()

        fill_price = float(o.get("priceAvg", 0)) if o.get("priceAvg") else None
        fill_qty = float(o.get("baseVolume", 0)) if o.get("baseVolume") else None

        return {
            "order_id": str(o.get("orderId", order_id)),
            "symbol": o.get("symbol", symbol),
            "side": o.get("side", "").upper(),
            "status": status_map.get(raw_status, "SUBMITTED"),
            "fill_price": fill_price,
            "fill_quantity": fill_qty,
        }

    def get_open_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get open orders."""
        params = {}
        if symbol:
            params["symbol"] = symbol

        data = self._request("GET", "/api/v2/spot/trade/unfilled-orders", params=params)

        orders = []
        if isinstance(data, list):
            for o in data:
                orders.append({
                    "order_id": str(o.get("orderId", "")),
                    "symbol": o.get("symbol", ""),
                    "side": o.get("side", "").upper(),
                    "order_type": o.get("orderType", "").upper(),
                    "quantity": float(o.get("size", 0)),
                    "price": float(o.get("price", 0)) if o.get("price") else None,
                    "status": "SUBMITTED",
                })
        return orders

    # ------------------------------------------------------------------
    # Withdrawal API
    # ------------------------------------------------------------------

    def withdraw(
        self,
        asset: str,
        amount: float,
        address: str,
        chain: str = "",
    ) -> Dict[str, Any]:
        """
        Initiate a withdrawal on Bitget.

        Args:
            asset: Coin to withdraw (e.g., "USDT")
            amount: Amount to withdraw
            address: Destination wallet address
            chain: Blockchain network (e.g., "TRC20", "ERC20")
        """
        body = {
            "coin": asset.upper(),
            "transferType": "on_chain",
            "address": address,
            "size": str(amount),
        }
        if chain:
            body["chain"] = chain

        data = self._request("POST", "/api/v2/spot/wallet/withdrawal", body=body)

        withdrawal_id = data.get("orderId", "")
        logger.info("Bitget withdrawal initiated: %s %s to %s -> %s",
                     amount, asset, address, withdrawal_id)

        return {
            "withdrawal_id": str(withdrawal_id),
            "asset": asset,
            "amount": amount,
            "address": address,
            "status": "SUBMITTED",
            "timestamp": time.time(),
        }


class BitgetAPIError(Exception):
    """Bitget API error with error code."""
    def __init__(self, message: str, code: str = "UNKNOWN"):
        super().__init__(message)
        self.code = code
