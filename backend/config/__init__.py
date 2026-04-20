# backend/config/__init__.py
"""
backend.config — Single runtime configuration authority.

Public API:
    from backend.config import get_settings, get_exchange_config, get_risk_config, ...
"""

from backend.config.settings import Settings, get_settings
from backend.config.loader import (
    ConfigError,
    load_and_validate,
    startup_or_exit,
    get_exchange_config,
    get_risk_config,
    get_redis_config,
    get_database_config,
    get_auth_config,
    get_metrics_config,
    get_websocket_config,
    get_price_aggregator_config,
)

__all__ = [
    "Settings",
    "get_settings",
    "ConfigError",
    "load_and_validate",
    "startup_or_exit",
    "get_exchange_config",
    "get_risk_config",
    "get_redis_config",
    "get_database_config",
    "get_auth_config",
    "get_metrics_config",
    "get_websocket_config",
    "get_price_aggregator_config",
]
