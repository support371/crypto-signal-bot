# backend/adapters/exchanges/__init__.py
"""
Exchange adapter registry and factory.

Usage:
    from backend.adapters.exchanges import get_adapter, get_market_data_adapter
    from backend.config.loader import get_exchange_config

    cfg     = get_exchange_config()
    adapter = get_adapter(cfg)          # execution adapter (BTCC primary)
    mda     = get_market_data_adapter(cfg)  # market data adapter (Binance primary in paper)
    ticker  = await mda.fetch_ticker("BTCUSDT")
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
    Execution adapter factory.

    Selection priority (live and paper):
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

    # BTCC — primary execution venue
    if cfg.btcc_api_key or paper:
        return BtccAdapter(
            api_key=cfg.btcc_api_key,
            api_secret=cfg.btcc_api_secret,
            paper=paper,
            base_url=cfg.btcc_base_url,
        )

    # Binance — live fallback
    if cfg.binance_api_key:
        return BinanceAdapter(
            api_key=cfg.binance_api_key,
            api_secret=cfg.binance_api_secret,
            paper=False,
            base_url=cfg.binance_base_url,
            testnet=cfg.binance_testnet,
        )

    # Bitget — live fallback
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


def get_market_data_adapter(cfg: "ExchangeConfig") -> BaseExchangeAdapter:
    """
    Market data adapter factory.

    In paper mode, CoinGecko is used as the public market data source.
    Binance returns HTTP 451 (geo-blocked) from Render server regions.
    CoinGecko is globally accessible, no auth required, 50 req/min free.

    Override via MARKET_DATA_PUBLIC_EXCHANGE env var:
      - "binance"    — use Binance (may be geo-blocked on some hosts)
      - "coingecko"  — use CoinGecko (default, globally accessible)

    In live mode, the execution adapter is also the market data source.
    """
    import os

    paper = cfg.mode == "paper"

    if not paper:
        # Live mode: use the execution adapter for market data too
        return get_adapter(cfg)

    # Paper mode: resolve from env, default to coingecko
    exchange_override = os.getenv("MARKET_DATA_PUBLIC_EXCHANGE", "coingecko").strip().lower()

    if exchange_override in ("coingecko", ""):
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

    if exchange_override == "bitget":
        from backend.adapters.exchanges.bitget import BitgetAdapter
        return BitgetAdapter(
            api_key=None, api_secret=None, passphrase=None,
            paper=True, base_url=cfg.bitget_base_url
        )

    # Fallback: coingecko
    from backend.adapters.exchanges.coingecko import CoinGeckoAdapter
    return CoinGeckoAdapter(paper=True)


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
    "CoinGeckoAdapter",
]
