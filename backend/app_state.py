"""Lazy accessors for app-level state used by route modules.

Route modules call these functions instead of importing backend.app
directly, avoiding circular imports. Follows the pattern established
in backend/dependencies.py.
"""

import sys
from typing import Any


def _app():
    return sys.modules["backend.app"]


def trading_mode() -> str:
    return _app().TRADING_MODE


def network() -> str:
    return _app().NETWORK


def exchange_name() -> str:
    return _app().EXCHANGE


def market_data_exchange() -> str:
    return _app().MARKET_DATA_PUBLIC_EXCHANGE


def paper_use_live_market_data() -> bool:
    return _app().PAPER_USE_LIVE_MARKET_DATA


def runtime_config():
    return _app().RUNTIME_CONFIG


def allowed_origins():
    return _app().ALLOWED_ORIGINS


def backend_api_key() -> str:
    return _app().BACKEND_API_KEY


def started_at() -> float:
    return _app()._STARTED_AT


def portfolio():
    return _app().paper_portfolio


def adapter():
    return _app().exchange_adapter


def risk_engine():
    return _app().risk_engine


def ws_manager():
    return _app().ws_manager


def get_market_data_status() -> dict[str, Any]:
    return _app()._get_market_data_status()


def get_market_data_service():
    return _app()._get_market_data_service()


def synthetic_price(symbol: str) -> float:
    return _app()._synthetic_price(symbol)


def process_intent(req, mode: str):
    return _app()._process_intent(req, mode)
