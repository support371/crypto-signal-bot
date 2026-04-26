"""
Abstract base class for exchange clients.

All exchange implementations (Bitget, BTCC, etc.) must implement this interface.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseExchangeClient(ABC):
    """Abstract exchange client interface."""

    def __init__(self, api_key: str, api_secret: str, passphrase: str = "",
                 testnet: bool = True):
        self.api_key = api_key
        self.api_secret = api_secret
        self.passphrase = passphrase
        self.testnet = testnet

    @property
    @abstractmethod
    def name(self) -> str:
        """Exchange name identifier."""

    @abstractmethod
    def get_ticker(self, symbol: str) -> Dict[str, Any]:
        """
        Get current ticker for a symbol.

        Returns:
            {"symbol": str, "last": float, "bid": float, "ask": float,
             "volume_24h": float, "timestamp": float}
        """

    @abstractmethod
    def get_balance(self) -> Dict[str, float]:
        """
        Get account balances.

        Returns:
            {"USDT": 10000.0, "BTC": 0.5, ...}
        """

    @abstractmethod
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
        Place an order on the exchange.

        Returns:
            {"order_id": str, "status": str, "fill_price": float|None,
             "fill_quantity": float|None, "timestamp": float}
        """

    @abstractmethod
    def cancel_order(self, symbol: str, order_id: str) -> Dict[str, Any]:
        """
        Cancel an open order.

        Returns:
            {"order_id": str, "status": "CANCELLED", "timestamp": float}
        """

    @abstractmethod
    def get_order(self, symbol: str, order_id: str) -> Dict[str, Any]:
        """
        Get order status by ID.

        Returns:
            {"order_id": str, "symbol": str, "side": str, "status": str,
             "fill_price": float|None, "fill_quantity": float|None}
        """

    @abstractmethod
    def get_open_orders(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all open orders, optionally filtered by symbol."""

    @abstractmethod
    def withdraw(
        self,
        asset: str,
        amount: float,
        address: str,
        chain: str = "",
    ) -> Dict[str, Any]:
        """
        Initiate a withdrawal.

        Returns:
            {"withdrawal_id": str, "asset": str, "amount": float,
             "address": str, "status": str, "timestamp": float}
        """

    @abstractmethod
    def get_server_time(self) -> float:
        """Get exchange server time as Unix timestamp (ms)."""
