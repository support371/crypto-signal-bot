# backend/config/loader.py
"""
PHASE 4 — Config loader with fail-fast startup validation.

Responsibilities:
  1. Validate all required settings at startup (before any service starts).
  2. Provide context-specific sub-configs to each service.
  3. Surface clear, actionable error messages when config is missing.
  4. Never allow the app to start with an invalid or ambiguous configuration.

Usage (in main.py or app factory):
    from backend.config.loader import load_and_validate, get_exchange_config

    config = load_and_validate()        # raises ConfigError on failure
    exchange_cfg = get_exchange_config()
"""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from typing import Optional

from pydantic import ValidationError

from backend.config.settings import Settings, get_settings

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Custom exception — wraps ValidationError with human-readable context
# ---------------------------------------------------------------------------

class ConfigError(RuntimeError):
    """Raised when configuration is invalid or incomplete at startup."""
    pass


# ---------------------------------------------------------------------------
# Sub-config dataclasses — typed slices for each service
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ExchangeConfig:
    mode: str  # "paper" | "live"
    btcc_api_key:       Optional[str]
    btcc_api_secret:    Optional[str]
    btcc_base_url:      str
    binance_api_key:    Optional[str]
    binance_api_secret: Optional[str]
    binance_base_url:   str
    binance_testnet:    bool
    bitget_api_key:     Optional[str]
    bitget_api_secret:  Optional[str]
    bitget_passphrase:  Optional[str]
    bitget_base_url:    str


@dataclass(frozen=True)
class RiskConfig:
    """
    Server-side risk defaults.
    These seed GET /risk/config and are read by the guardian.
    They are NOT the client-supplied values (removed in Phase 3).
    """
    risk_tolerance:           float
    position_size_fraction:   float
    spread_stress_threshold:  float
    volatility_sensitivity:   float
    max_drawdown_pct:         float
    max_api_errors:           int
    max_failed_orders:        int


@dataclass(frozen=True)
class RedisConfig:
    url:                   str
    price_ttl_seconds:     int
    signal_ttl_seconds:    int


@dataclass(frozen=True)
class DatabaseConfig:
    url:        str
    pool_size:  int
    max_overflow: int
    echo:       bool


@dataclass(frozen=True)
class AuthConfig:
    api_key: Optional[str]
    auth_enabled: bool  # True when api_key is set


@dataclass(frozen=True)
class MetricsConfig:
    enabled: bool
    path:    str


@dataclass(frozen=True)
class WebSocketConfig:
    path:                     str
    heartbeat_interval_seconds: int
    reconnect_grace_seconds:  int


@dataclass(frozen=True)
class PriceAggregatorConfig:
    primary:          str  # "exchange" | "coingecko"
    coingecko_api_key: Optional[str]
    cors_allowed_origins: list[str]


# ---------------------------------------------------------------------------
# Main loader
# ---------------------------------------------------------------------------

def load_and_validate() -> Settings:
    """
    Load settings and validate all required fields.
    Raises ConfigError with a clear message if validation fails.
    Logs all configuration state (redacting secrets) at INFO level.

    Call this once at application startup, before starting any service.
    """
    try:
        settings = get_settings()
    except ValidationError as exc:
        # Format each error into a single actionable message
        lines = ["Backend startup failed — configuration errors:"]
        for err in exc.errors():
            field = " → ".join(str(loc) for loc in err["loc"])
            msg   = err["msg"]
            lines.append(f"  • {field}: {msg}")
        lines.append(
            "\nFix these in your .env file or environment variables, then restart."
        )
        raise ConfigError("\n".join(lines)) from exc

    _log_startup_summary(settings)
    return settings


def _log_startup_summary(s: Settings) -> None:
    """Log the resolved config (secrets redacted) at startup."""
    log.info("=== crypto-signal-bot config ===")
    log.info("  exchange_mode   : %s", s.exchange_mode)
    log.info("  btcc_api_key    : %s", "SET" if s.btcc_api_key else "NOT SET")
    log.info("  binance_api_key : %s", "SET" if s.binance_api_key else "NOT SET")
    log.info("  bitget_api_key  : %s", "SET" if s.bitget_api_key else "NOT SET")
    log.info("  database_url    : %s", _redact(s.database_url))
    log.info("  redis_url       : %s", _redact(s.redis_url))
    log.info("  auth_enabled    : %s", bool(s.backend_api_key))
    log.info("  metrics_enabled : %s", s.metrics_enabled)
    log.info("  ws_path         : %s", s.ws_path)
    log.info("  price_primary   : %s", s.price_aggregator_primary)
    log.info("  cors_origins    : %s", s.cors_allowed_origins or "(none — CORS open)")
    log.info("=================================")


def _redact(url: str) -> str:
    """Redact credentials from a connection URL for safe logging."""
    try:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(url)
        if parsed.password:
            netloc = parsed.hostname or ""
            if parsed.port:
                netloc = f"{netloc}:{parsed.port}"
            return urlunparse(parsed._replace(netloc=f"{parsed.username}:***@{netloc}"))
    except Exception:
        pass
    return url


# ---------------------------------------------------------------------------
# Sub-config accessors — used by each service to get its slice
# ---------------------------------------------------------------------------

def get_exchange_config() -> ExchangeConfig:
    s = get_settings()
    return ExchangeConfig(
        mode=s.exchange_mode,
        btcc_api_key=s.btcc_api_key,
        btcc_api_secret=s.btcc_api_secret,
        btcc_base_url=s.btcc_base_url,
        binance_api_key=s.binance_api_key,
        binance_api_secret=s.binance_api_secret,
        binance_base_url=s.binance_base_url,
        binance_testnet=s.binance_testnet,
        bitget_api_key=s.bitget_api_key,
        bitget_api_secret=s.bitget_api_secret,
        bitget_passphrase=s.bitget_passphrase,
        bitget_base_url=s.bitget_base_url,
    )


def get_risk_config() -> RiskConfig:
    """
    Server-side risk defaults. Seeds GET /risk/config.
    Do NOT pass to backend/logic/risk.py directly — that file is protected.
    The risk engine reads its own thresholds; this config is for the API layer.
    """
    s = get_settings()
    return RiskConfig(
        risk_tolerance=s.default_risk_tolerance,
        position_size_fraction=s.default_position_size_fraction,
        spread_stress_threshold=s.default_spread_stress_threshold,
        volatility_sensitivity=s.default_volatility_sensitivity,
        max_drawdown_pct=s.guardian_max_drawdown_pct,
        max_api_errors=s.guardian_max_api_errors,
        max_failed_orders=s.guardian_max_failed_orders,
    )


def get_redis_config() -> RedisConfig:
    s = get_settings()
    return RedisConfig(
        url=s.redis_url,
        price_ttl_seconds=s.redis_price_ttl_seconds,
        signal_ttl_seconds=s.redis_signal_ttl_seconds,
    )


def get_database_config() -> DatabaseConfig:
    s = get_settings()
    return DatabaseConfig(
        url=s.database_url,
        pool_size=s.db_pool_size,
        max_overflow=s.db_max_overflow,
        echo=s.db_echo,
    )


def get_auth_config() -> AuthConfig:
    s = get_settings()
    return AuthConfig(
        api_key=s.backend_api_key,
        auth_enabled=bool(s.backend_api_key),
    )


def get_metrics_config() -> MetricsConfig:
    s = get_settings()
    return MetricsConfig(enabled=s.metrics_enabled, path=s.metrics_path)


def get_websocket_config() -> WebSocketConfig:
    s = get_settings()
    return WebSocketConfig(
        path=s.ws_path,
        heartbeat_interval_seconds=s.ws_heartbeat_interval_seconds,
        reconnect_grace_seconds=s.ws_reconnect_grace_seconds,
    )


def get_price_aggregator_config() -> PriceAggregatorConfig:
    s = get_settings()
    return PriceAggregatorConfig(
        primary=s.price_aggregator_primary,
        coingecko_api_key=s.coingecko_api_key,
        cors_allowed_origins=s.cors_allowed_origins,
    )


# ---------------------------------------------------------------------------
# Convenience: called from main.py before uvicorn starts
# ---------------------------------------------------------------------------

def startup_or_exit() -> Settings:
    """
    Load and validate config. Exit the process with code 1 on failure.
    Use this at the application entrypoint to guarantee clean fail-fast.

    Example in main.py:
        from backend.config.loader import startup_or_exit
        settings = startup_or_exit()
    """
    try:
        return load_and_validate()
    except ConfigError as exc:
        log.critical("\n%s", exc)
        sys.exit(1)
