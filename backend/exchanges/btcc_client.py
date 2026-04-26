"""
BTCC exchange client with HMAC-SHA256 request signing.

Supports spot trading: market/limit orders, balance queries, withdrawals.
Uses BTCC REST API.

Docs: https://www.btcc.com/apidocs
"""

import hashlib
import hmac
import time
import logging
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import httpx

from backend.exchanges.base_client import BaseExchangeClient

logger = logging.getLogger("btcc_client")

_BASE_URL = "https://api.btcc.com"


class BTCCClient(BaseExchangeClient):
    """BTCC spot exchange client with HMAC-SHA256 signing."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        passphrase: str = "",
        testnet: bool = True,
        timeout: float = 10.0,
    ):
        super().__init__(api_key, api_secret, passphrase, testnet)
        self.base_url = _BASE_URL
        self.timeout = timeout
        self._client = httpx.Client(timeout=timeout)

    @property
    def name(self) -> str:
        return "btcc"

    # ------------------------------------------------------------------
    # Request signing (HMAC-SHA256)
    # ------------------------------------------------------------------

    def _timestamp(self) -> str:
        return str(int(time.time() * 1000))

    def _sign(self, params: Dict[str, str]) -> str:
        """
        Create HMAC-SHA256 signature.

        Prehash: sorted query string of all params
        """
        sorted_params = urlencode(sorted(params.items()))
        mac = hmac.new(
            self.api_secret.encode("utf-8"),
            sorted_params.encode("utf-8"),
            hashlib.sha256,
        )
        return mac.hexdigest()

    def _auth_params(self, extra: Optional[Dict] = None) -> Dict[str, str]:
        """Build signed parameter dict."""
        params = {
            "api_key": self.api_key,
            "timestamp": self._timestamp(),
        }
        if extra:
            params.update(extra)

        params["sign"] = self._sign(params)
        return params

    def _request(
        self, method: str, path: str, params: Optional[Dict] = None,
        body: Optional[Dict] = None, authenticated: bool = True,
    ) -> Dict[str, Any]:
        """Execute API request with optional authentication."""
        url = self.base_url + path

        if authenticated:
            auth_params = self._auth_params(params or {})
        else:
            auth_params = params or {}

        try:
            if method == "GET":
                resp = self._client.get(url, params=auth_params)
            elif method == "POST":
                resp = self._client.post(url, json={**auth_params, **(body or {})})
            else:
                raise ValueError(f"Unsupported method: {method}")

            data = resp.json()

            if resp.status_code != 200:
                error_msg = data.get("message", data.get("msg", f"HTTP {resp.status_code}"))
                logger.error("BTCC API error: %s", error_msg)
                raise BTCCAPIError(error_msg, resp.status_code)

            if data.get("code") and str(data["code"]) != "0":
                error_msg = data.get("message", data.get("msg", "Unknown error"))
                raise BTCCAPIError(error_msg, data.get("code"))

            return data.get("data", data.get("result", data))

        except httpx.TimeoutException:
            logger.error("BTCC API timeout: %s %s", method, path)
            raise BTCCAPIError("Request timeout", "TIMEOUT")
        except httpx.RequestError as e:
            logger.error("BTCC API network error: %s", e)
            raise BTCCAPIError(f"Network error: {e}", "NETWORK")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_server_time(self) -> float:
        """Get BTCC server time (ms)."""
        data = self._request("GET", "/api/v1/time", authenticated=False)
        return float(data.get("serverTime", time.time() * 1000))

    def get_ticker(self, symbol: str) -> Dict[str, Any]:
        """Get spot ticker for a symbol."""
        data = self._request(
            "GET", "/api/v1/ticker",
            params={"symbol": symbol},
            authenticated=False,
        )

        if isinstance(data, list) and len(data) > 0:
            t = data[0]
        elif isinstance(data, dict):
            t = data
        else:
            raise BTCCAPIError(f"No ticker data for {symbol}", "NO_DATA")

        return {
            "symbol": t.get("symbol", symbol),
            "last": float(t.get("last", t.get("lastPrice", 0))),
            "bid": float(t.get("bid", t.get("bidPrice", 0))),
            "ask": float(t.get("ask", t.get("askPrice", 0))),
            "volume_24h": float(t.get("volume", t.get("volume24h", 0))),
            "timestamp": time.time(),
        }

    # ------------------------------------------------------------------
    # Account API
    # ------------------------------------------------------------------

    def get_balance(self) -> Dict[str, float]:
        """Get spot account balances."""
        data = self._request("GET", "/api/v1/account/balance")

        balances = {}
        if isinstance(data, list):
            for asset in data:
                coin = asset.get("currency", asset.get("coin", ""))
                available = float(asset.get("available", asset.get("free", 0)))
                if available > 0:
                    balances[coin] = available
        elif isinstance(data, dict):
            for coin, info in data.items():
                if isinstance(info, dict):
                    available = float(info.get("available", info.get("free", 0)))
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
        """Place a spot order on BTCC."""
        body = {
            "symbol": symbol,
            "side": side.upper(),
            "type": order_type.upper(),
            "quantity": str(quantity),
        }

        if order_type.upper() == "LIMIT" and price is not None:
            body["price"] = str(price)
            body["timeInForce"] = time_in_force.upper()

        data = self._request("POST", "/api/v1/order", body=body)

        order_id = data.get("orderId", data.get("order_id", ""))
        logger.info("BTCC order placed: %s %s %s qty=%s -> order_id=%s",
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
        self._request(
            "POST", "/api/v1/order/cancel",
            body={"symbol": symbol, "orderId": order_id},
        )
        logger.info("BTCC order cancelled: %s", order_id)
        return {
            "order_id": order_id,
            "status": "CANCELLED",
            "timestamp": time.time(),
        }

    def get_order(self, symbol: str, order_id: str) -> Dict[str, Any]:
        """Get order details by ID."""
        data = self._request(
            "GET", "/api/v1/order",
            params={"symbol": symbol, "orderId": order_id},
        )

        status_map = {
            "NEW": "SUBMITTED",
            "PARTIALLY_FILLED": "PARTIALLY_FILLED",
            "FILLED": "FILLED",
            "CANCELED": "CANCELLED",
            "CANCELLED": "CANCELLED",
            "REJECTED": "FAILED",
        }

        raw_status = data.get("status", "").upper()
        fill_price = float(data.get("avgPrice", 0)) if data.get("avgPrice") else None
        fill_qty = float(data.get("executedQty", 0)) if data.get("executedQty") else None

        return {
            "order_id": str(data.get("orderId", order_id)),
            "symbol": data.get("symbol", symbol),
            "side": data.get("side", "").upper(),
            "status": status_map.get(raw_status, "SUBMITTED"),
            "fill_price": fill_price,
            "fill_quantity": fill_qty,
        }

    def get_open_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get open orders."""
        params = {}
        if symbol:
            params["symbol"] = symbol

        data = self._request("GET", "/api/v1/openOrders", params=params)

        orders = []
        if isinstance(data, list):
            for o in data:
                orders.append({
                    "order_id": str(o.get("orderId", "")),
                    "symbol": o.get("symbol", ""),
                    "side": o.get("side", "").upper(),
                    "order_type": o.get("type", "").upper(),
                    "quantity": float(o.get("origQty", o.get("quantity", 0))),
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
        """Initiate a withdrawal on BTCC."""
        body = {
            "coin": asset.upper(),
            "amount": str(amount),
            "address": address,
        }
        if chain:
            body["chain"] = chain

        data = self._request("POST", "/api/v1/withdraw", body=body)

        withdrawal_id = data.get("id", data.get("withdrawId", ""))
        logger.info("BTCC withdrawal initiated: %s %s to %s -> %s",
                     amount, asset, address, withdrawal_id)

        return {
            "withdrawal_id": str(withdrawal_id),
            "asset": asset,
            "amount": amount,
            "address": address,
            "status": "SUBMITTED",
            "timestamp": time.time(),
        }


class BTCCAPIError(Exception):
    """BTCC API error."""
    def __init__(self, message: str, code: Any = "UNKNOWN"):
        super().__init__(message)
        self.code = code
