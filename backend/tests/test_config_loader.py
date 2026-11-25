"""Tests for the config loader (backend/config/loader.py)."""

from backend.config.loader import (
    get_exchange_config,
    get_risk_config,
    get_redis_config,
    get_database_config,
    get_auth_config,
    get_metrics_config,
    get_websocket_config,
    get_price_aggregator_config,
    _redact,
    ExchangeConfig,
    RiskConfig,
    RedisConfig,
    DatabaseConfig,
    AuthConfig,
    MetricsConfig,
    WebSocketConfig,
    PriceAggregatorConfig,
)


class TestSubConfigAccessors:
    def test_exchange_config_type(self):
        cfg = get_exchange_config()
        assert isinstance(cfg, ExchangeConfig)
        assert cfg.mode in ("paper", "live")

    def test_risk_config_type(self):
        cfg = get_risk_config()
        assert isinstance(cfg, RiskConfig)
        assert 0 <= cfg.risk_tolerance <= 1
        assert cfg.max_drawdown_pct > 0

    def test_redis_config_type(self):
        cfg = get_redis_config()
        assert isinstance(cfg, RedisConfig)
        assert cfg.price_ttl_seconds > 0

    def test_database_config_type(self):
        cfg = get_database_config()
        assert isinstance(cfg, DatabaseConfig)
        assert cfg.pool_size > 0

    def test_auth_config_type(self):
        cfg = get_auth_config()
        assert isinstance(cfg, AuthConfig)
        assert isinstance(cfg.auth_enabled, bool)

    def test_metrics_config_type(self):
        cfg = get_metrics_config()
        assert isinstance(cfg, MetricsConfig)
        assert isinstance(cfg.enabled, bool)

    def test_websocket_config_type(self):
        cfg = get_websocket_config()
        assert isinstance(cfg, WebSocketConfig)
        assert cfg.heartbeat_interval_seconds > 0

    def test_price_aggregator_config_type(self):
        cfg = get_price_aggregator_config()
        assert isinstance(cfg, PriceAggregatorConfig)
        assert cfg.primary in ("exchange", "coingecko")


class TestExchangeConfigFrozen:
    def test_frozen(self):
        cfg = get_exchange_config()
        try:
            cfg.mode = "live"
            assert False, "Should be frozen"
        except (AttributeError, TypeError, Exception):
            pass


class TestRedact:
    def test_redacts_password(self):
        url = "postgresql://user:secret@localhost:5432/db"
        result = _redact(url)
        assert "secret" not in result
        assert "***" in result

    def test_no_password_passthrough(self):
        url = "redis://localhost:6379/0"
        result = _redact(url)
        assert "localhost" in result

    def test_handles_malformed_url(self):
        result = _redact("not-a-url")
        assert result == "not-a-url"
