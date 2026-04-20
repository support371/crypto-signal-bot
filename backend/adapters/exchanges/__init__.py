# backend/adapters/exchanges/__init__.py
"""
Exchange adapter registry and factory.

Usage:
    from backend.adapters.exchanges import get_adapter
    from backend.config.loader import get_exchange_config

    cfg     = get_exchange_config()
    adapter = get_adapter(cfg)
    ticker  = await adapter.fetch_ticker("BTCUSDT")
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from backend.adapters.exchanges.base import (
    BaseExchangeAdapter,
    AdapterError,
    AdapterAuthError,
    AdapterRateLimitError,
    AdapterSymbolNotFoundError,
    AdapterOrderError,
    AdapterUnavailableError,
    Ticker,
    Balance,
    Position,
    Order,
    OhlcvCandle,
    ExchangeStatus,
)

if TYPE_CHECKING:
    from backend.config.loader import ExchangeConfig


def get_adapter(cfg: "ExchangeConfig") -> BaseExchangeAdapter:
    """
    Factory: return the correct adapter for the configured exchange mode.

    Selection priority:
      1. BTCC (primary scaffold per CLAUDE.md)
      2. Binance
      3. Bitget

    In paper mode all three can run without live credentials.
    In live mode the adapter with valid credentials is used.
    """
    from backend.adapters.exchanges.btcc    import BtccAdapter
    from backend.adapters.exchanges.binance import BinanceAdapter
    from backend.adapters.exchanges.bitget  import BitgetAdapter

    paper = cfg.mode == "paper"

    # BTCC — first choice
    if cfg.btcc_api_key or paper:
        return BtccAdapter(
            api_key=cfg.btcc_api_key,
            api_secret=cfg.btcc_api_secret,
            paper=paper,
            base_url=cfg.btcc_base_url,
        )

    # Binance — second choice
    if cfg.binance_api_key:
        return BinanceAdapter(
            api_key=cfg.binance_api_key,
            api_secret=cfg.binance_api_secret,
            paper=False,
            base_url=cfg.binance_base_url,
            testnet=cfg.binance_testnet,
        )

    # Bitget — third choice
    if cfg.bitget_api_key:
        return BitgetAdapter(
            api_key=cfg.bitget_api_key,
            api_secret=cfg.bitget_api_secret,
            passphrase=cfg.bitget_passphrase,
            paper=False,
            base_url=cfg.bitget_base_url,
        )

    raise AdapterError(
        "No exchange adapter could be configured. "
        "Provide credentials for BTCC, Binance, or Bitget in settings."
    )


__all__ = [
    "get_adapter",
    "BaseExchangeAdapter",
    "AdapterError",
    "AdapterAuthError",
    "AdapterRateLimitError",
    "AdapterSymbolNotFoundError",
    "AdapterOrderError",
    "AdapterUnavailableError",
    "Ticker",
    "Balance",
    "Position",
    "Order",
    "OhlcvCandle",
    "ExchangeStatus",
]
