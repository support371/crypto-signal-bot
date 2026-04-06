"""
Runtime configuration loader.

YAML provides the baseline operational defaults, while environment variables
remain the authoritative override layer for deployment-specific values.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class ServerConfig:
    cors_origins: list[str]


@dataclass(frozen=True)
class GuardianConfig:
    max_api_errors: int
    max_failed_orders: int
    max_drawdown_pct: float


@dataclass(frozen=True)
class PersistenceConfig:
    audit_store_path: str
    earnings_store_path: str


@dataclass(frozen=True)
class PaperConfig:
    starting_balance_usdt: float
    use_live_market_data: bool


@dataclass(frozen=True)
class RuntimeConfig:
    trading_mode: str
    network: str
    exchange: str
    market_data_public_exchange: str
    backend_api_key: str
    rate_limit_rpm: int
    allow_mainnet: bool
    server: ServerConfig
    guardian: GuardianConfig
    persistence: PersistenceConfig
    paper: PaperConfig
    config_path: str


_CONFIG_PATH = Path(__file__).with_name("config.yaml")


@lru_cache(maxsize=1)
def load_yaml_defaults() -> dict[str, Any]:
    try:
        with _CONFIG_PATH.open("r", encoding="utf-8") as handle:
            loaded = yaml.safe_load(handle) or {}
    except FileNotFoundError:
        loaded = {}
    return loaded if isinstance(loaded, dict) else {}


def _get_nested(data: dict[str, Any], *keys: str, default: Any) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current


def _env_str(name: str, default: str) -> str:
    return os.getenv(name, default)


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def _normalize_exchange(value: str, default: str = "binance") -> str:
    normalized = (value or "").strip().lower()
    if normalized in {"binance", "bitget", "btcc"}:
        return normalized
    return default


def _env_csv(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return list(default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def get_runtime_config() -> RuntimeConfig:
    defaults = load_yaml_defaults()

    default_cors = _get_nested(
        defaults,
        "server",
        "cors_origins",
        default=["http://localhost:5173", "http://localhost:8080", "http://localhost:3000"],
    )
    if not isinstance(default_cors, list):
        default_cors = ["http://localhost:5173", "http://localhost:8080", "http://localhost:3000"]

    guardian_defaults = GuardianConfig(
        max_api_errors=int(_get_nested(defaults, "kill_switch", "max_api_errors", default=10)),
        max_failed_orders=int(_get_nested(defaults, "kill_switch", "max_failed_orders", default=5)),
        max_drawdown_pct=float(_get_nested(defaults, "kill_switch", "max_daily_loss_pct", default=0.05)),
    )

    paper_defaults = PaperConfig(
        starting_balance_usdt=float(
            _get_nested(defaults, "paper", "starting_balance_usdt", default=10000.0)
        ),
        use_live_market_data=bool(
            _get_nested(defaults, "paper", "use_live_market_data", default=False)
        ),
    )

    return RuntimeConfig(
        trading_mode=_env_str("TRADING_MODE", "paper"),
        network=_env_str("NETWORK", "testnet"),
        exchange=_normalize_exchange(
            _env_str(
                "EXCHANGE",
                str(_get_nested(defaults, "exchange", "default", default="binance")),
            )
        ),
        market_data_public_exchange=_normalize_exchange(
            _env_str(
                "MARKET_DATA_PUBLIC_EXCHANGE",
                str(
                    _get_nested(
                        defaults,
                        "market_data",
                        "public_exchange",
                        default=_get_nested(defaults, "exchange", "default", default="binance"),
                    )
                ),
            )
        ),
        backend_api_key=_env_str("BACKEND_API_KEY", ""),
        rate_limit_rpm=_env_int("RATE_LIMIT_RPM", 120),
        allow_mainnet=_env_bool("ALLOW_MAINNET", False),
        server=ServerConfig(cors_origins=_env_csv("CORS_ORIGINS", default_cors)),
        guardian=GuardianConfig(
            max_api_errors=_env_int("GUARDIAN_MAX_API_ERRORS", guardian_defaults.max_api_errors),
            max_failed_orders=_env_int(
                "GUARDIAN_MAX_FAILED_ORDERS", guardian_defaults.max_failed_orders
            ),
            max_drawdown_pct=_env_float(
                "GUARDIAN_MAX_DRAWDOWN_PCT", guardian_defaults.max_drawdown_pct
            ),
        ),
        persistence=PersistenceConfig(
            audit_store_path=_env_str("AUDIT_STORE_PATH", "backend/data/audit.json"),
            earnings_store_path=_env_str("EARNINGS_STORE_PATH", "backend/data/earnings.json"),
        ),
        paper=PaperConfig(
            starting_balance_usdt=paper_defaults.starting_balance_usdt,
            use_live_market_data=_env_bool(
                "PAPER_USE_LIVE_MARKET_DATA", paper_defaults.use_live_market_data
            ),
        ),
        config_path=str(_CONFIG_PATH),
    )
