# backend/adapters/exchanges/__init__.py
"""
Exchange adapter registry and factory.

Canonical execution priority:
    1. BTCC
    2. Bitget

Coinbase remains optional public/read-only market data. Binance and CoinGecko
may remain available as explicitly selected legacy data sources, but they are
not default execution venues.
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
    """Return the canonical execution adapter: BTCC first, Bitget second."""
    from backend.adapters.exchanges.btcc import BtccAdapter
    from backend.adapters.exchanges.bitget import BitgetAdapter

    paper = cfg.mode == "paper"

    # BTCC is the primary execution venue. Paper mode remains non-mutating.
    if cfg.btcc_api_key or paper:
        return BtccAdapter(
            api_key=cfg.btcc_api_key,
            api_secret=cfg.btcc_api_secret,
            paper=paper,
            base_url=cfg.btcc_base_url,
        )

    # Bitget is the only default execution fallback.
    if cfg.bitget_api_key:
        return BitgetAdapter(
            api_key=cfg.bitget_api_key,
            api_secret=cfg.bitget_api_secret,
            passphrase=cfg.bitget_passphrase,
            paper=False,
            base_url=cfg.bitget_base_url,
        )

    raise AdapterError(
        "No canonical exchange adapter could be configured. "
        "BTCC is primary and Bitget is secondary."
    )


def get_market_data_adapter(cfg: "ExchangeConfig") -> BaseExchangeAdapter:
    """
    Return the selected public market-data adapter.

    Bitget is the default public source. BTCC may be selected explicitly.
    Coinbase remains optional public/read-only data. CoinGecko and Binance are
    retained only as explicit legacy data-source selections.
    """
    import os

    exchange_override = os.getenv("MARKET_DATA_PUBLIC_EXCHANGE", "bitget").strip().lower()

    if exchange_override in ("bitget", "bitgate", ""):
        from backend.adapters.exchanges.bitget import BitgetAdapter
        return BitgetAdapter(
            api_key=None,
            api_secret=None,
            passphrase=None,
            paper=True,
            base_url=cfg.bitget_base_url,
        )

    if exchange_override == "btcc":
        from backend.adapters.exchanges.btcc import BtccAdapter
        return BtccAdapter(
            api_key=None,
            api_secret=None,
            paper=True,
            base_url=cfg.btcc_base_url,
        )

    if exchange_override == "coinbase":
        from backend.adapters.exchanges.coinbase import CoinbaseAdapter
        return CoinbaseAdapter()

    if exchange_override == "coingecko":
        from backend.adapters.exchanges.coingecko import CoinGeckoAdapter
        return CoinGeckoAdapter(paper=True)

    if exchange_override == "binance":
        from backend.adapters.exchanges.binance import BinanceAdapter
        return BinanceAdapter(
            api_key=None,
            api_secret=None,
            paper=True,
            base_url=cfg.binance_base_url,
            testnet=False,
        )

    raise AdapterError(
        "Unsupported MARKET_DATA_PUBLIC_EXCHANGE. "
        "Use bitget, btcc, coinbase, coingecko, or binance."
    )


__all__ = [
    "get_adapter",
    "get_market_data_adapter",
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
