# backend/config/settings.py
"""
PHASE 4 — Single runtime config authority.

Every setting the backend needs lives here.
Protected strategy files (backend/logic/*.py, backend/models_core.py,
backend/models/execution_intent.py) are NOT imported or modified.

Design rules:
  - Fail fast on required settings.
  - No hardcoded runtime values in application code.
  - Settings are read once at startup via get_settings().
  - All environment variables are documented here.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Complete runtime configuration for the crypto-signal-bot backend.

    Source priority (pydantic-settings default):
        1. Environment variables (production — Vercel / Docker)
        2. .env file (local development)
        3. Field defaults (non-required only)

    Required fields have no default and will raise ValidationError at startup
    if not supplied. This is intentional — fail loud, not silently degraded.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",  # ignore unknown vars from the environment
    )

    # -------------------------------------------------------------------------
    # Exchange / execution mode
    # -------------------------------------------------------------------------

    exchange_mode: Literal["paper", "live"] = Field(
        default="paper",
        description="Execution mode. 'paper' for simulation, 'live' for real orders.",
    )

    # BTCC (primary exchange scaffold, per CLAUDE.md)
    btcc_api_key: Optional[str] = Field(
        default=None,
        description="BTCC REST API key. Required when exchange_mode=live.",
    )
    btcc_api_secret: Optional[str] = Field(
        default=None,
        description="BTCC REST API secret. Required when exchange_mode=live.",
    )
    btcc_base_url: str = Field(
        default="https://api.btcc.com",
        description="BTCC REST base URL.",
    )

    # Binance
    binance_api_key: Optional[str] = Field(default=None)
    binance_api_secret: Optional[str] = Field(default=None)
    binance_base_url: str = Field(default="https://api.binance.com")
    binance_testnet: bool = Field(
        default=True,
        description="Use Binance testnet when True (safe default).",
    )

    # Bitget
    bitget_api_key: Optional[str] = Field(default=None)
    bitget_api_secret: Optional[str] = Field(default=None)
    bitget_passphrase: Optional[str] = Field(
        default=None,
        description="Bitget requires a passphrase in addition to key/secret.",
    )
    bitget_base_url: str = Field(default="https://api.bitget.com")

    # -------------------------------------------------------------------------
    # Risk defaults
    # These are the server-side defaults for GET /risk/config.
    # They are NOT read from client localStorage (Phase 3 removed that).
    # Operators can override via PUT /risk/config (persisted to DB).
    # Protected files backend/logic/risk.py derive thresholds from these defaults.
    # -------------------------------------------------------------------------

    default_risk_tolerance: float = Field(
        default=0.5,
        ge=0.0, le=1.0,
        description="Default risk tolerance fraction (0=conservative, 1=aggressive).",
    )
    default_position_size_fraction: float = Field(
        default=0.1,
        ge=0.01, le=0.25,
        description="Default max position size as fraction of NAV.",
    )
    default_spread_stress_threshold: float = Field(
        default=0.002,
        gt=0.0,
        description="Spread percentage above which stress is flagged.",
    )
    default_volatility_sensitivity: float = Field(
        default=0.5,
        ge=0.0, le=1.0,
        description="How strongly volatility spikes affect risk calculations.",
    )

    # -------------------------------------------------------------------------
    # Guardian thresholds
    # -------------------------------------------------------------------------

    guardian_max_drawdown_pct: float = Field(
        default=5.0,
        gt=0.0,
        description="Guardian kills trading when drawdown exceeds this percentage.",
    )
    guardian_max_api_errors: int = Field(
        default=10,
        gt=0,
        description="Guardian activates kill switch after this many consecutive API errors.",
    )
    guardian_max_failed_orders: int = Field(
        default=5,
        gt=0,
        description="Guardian activates kill switch after this many failed orders.",
    )

    # -------------------------------------------------------------------------
    # Redis
    # -------------------------------------------------------------------------

    redis_url: str = Field(
        default="redis://localhost:6379/0",
        description=(
            "Redis connection URL. "
            "Used for: kill switch flag, price cache, signal cache, "
            "WebSocket pub/sub, guardian counters."
        ),
    )
    redis_price_ttl_seconds: int = Field(
        default=35,
        description="TTL for cached price data (slightly longer than 30s poll interval).",
    )
    redis_signal_ttl_seconds: int = Field(
        default=900,
        description="TTL for cached signal per symbol (15 min).",
    )

    # -------------------------------------------------------------------------
    # Database
    # REQUIRED — no default. App must not start without a database.
    # -------------------------------------------------------------------------

    database_url: str = Field(
        ...,
        description=(
            "PostgreSQL connection URL (production) or SQLite URL (staging). "
            "Example: postgresql+asyncpg://user:pass@host/dbname"
        ),
    )
    db_pool_size: int = Field(default=10)
    db_max_overflow: int = Field(default=20)
    db_echo: bool = Field(
        default=False,
        description="Log all SQL statements. Set True only in development.",
    )

    # -------------------------------------------------------------------------
    # Authentication
    # -------------------------------------------------------------------------

    backend_api_key: Optional[str] = Field(
        default=None,
        description=(
            "Operator API key. When set, all write endpoints require "
            "X-API-Key: <value>. If None, write endpoints are unauthenticated "
            "(acceptable only in a fully private network)."
        ),
    )

    # -------------------------------------------------------------------------
    # Metrics / Prometheus
    # -------------------------------------------------------------------------

    metrics_enabled: bool = Field(default=True)
    metrics_path: str = Field(default="/metrics")

    # -------------------------------------------------------------------------
    # WebSocket broadcaster
    # -------------------------------------------------------------------------

    ws_path: str = Field(default="/ws/updates")
    ws_heartbeat_interval_seconds: int = Field(
        default=30,
        description="How often the broadcaster sends a heartbeat ping to clients.",
    )
    ws_reconnect_grace_seconds: int = Field(
        default=5,
        description="Backend grace period before cleaning up a dropped WS connection.",
    )

    # -------------------------------------------------------------------------
    # Price aggregator
    # -------------------------------------------------------------------------

    price_aggregator_primary: Literal["exchange", "coingecko"] = Field(
        default="exchange",
        description=(
            "Primary price source for the backend aggregator. "
            "CoinGecko is a server-side enrichment source only — "
            "never exposed to the frontend directly (Phase 3 rule)."
        ),
    )
    coingecko_api_key: Optional[str] = Field(
        default=None,
        description="CoinGecko Pro API key for higher rate limits (optional).",
    )

    # -------------------------------------------------------------------------
    # CORS
    # -------------------------------------------------------------------------

    cors_allowed_origins: list[str] = Field(
        default_factory=list,
        description=(
            "List of allowed frontend origins for CORS. "
            "Example: ['https://crypto-signal-bot-alpha.vercel.app']"
        ),
    )

    # -------------------------------------------------------------------------
    # Validators
    # -------------------------------------------------------------------------

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("DATABASE_URL must not be empty.")
        if "sqlite" not in v and "postgresql" not in v and "postgres" not in v:
            raise ValueError(
                f"Unrecognised database scheme in DATABASE_URL: {v!r}. "
                "Expected postgresql:// or sqlite:///."
            )
        return v.strip()

    @model_validator(mode="after")
    def validate_live_mode_credentials(self) -> "Settings":
        """Live mode requires at least one exchange to have credentials."""
        if self.exchange_mode == "live":
            has_btcc    = bool(self.btcc_api_key and self.btcc_api_secret)
            has_binance = bool(self.binance_api_key and self.binance_api_secret)
            has_bitget  = bool(
                self.bitget_api_key
                and self.bitget_api_secret
                and self.bitget_passphrase
            )
            if not (has_btcc or has_binance or has_bitget):
                raise ValueError(
                    "exchange_mode=live requires at least one exchange with "
                    "full API credentials (BTCC, Binance, or Bitget)."
                )
        return self

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: object) -> list[str]:
        """Accept comma-separated string from environment or a list."""
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v  # type: ignore[return-value]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    Return the validated Settings singleton.

    Raises pydantic.ValidationError on the first call if any required
    setting is missing — this surfaces at startup, not at runtime.

    Usage:
        from backend.config.settings import get_settings
        settings = get_settings()
        mode = settings.exchange_mode
    """
    return Settings()
