"""Tests for YAML-backed runtime configuration with env overrides."""

from backend.config.runtime import get_runtime_config
from backend.logic.paper_trading import PaperPortfolio


class TestRuntimeConfig:
    def test_yaml_defaults_used_when_env_missing(self, monkeypatch):
        monkeypatch.delenv("TRADING_MODE", raising=False)
        monkeypatch.delenv("NETWORK", raising=False)
        monkeypatch.delenv("PAPER_USE_LIVE_MARKET_DATA", raising=False)
        monkeypatch.delenv("GUARDIAN_MAX_API_ERRORS", raising=False)
        monkeypatch.delenv("CORS_ORIGINS", raising=False)

        config = get_runtime_config()

        assert config.trading_mode == "paper"
        assert config.network == "testnet"
        assert config.paper.use_live_market_data is False
        assert config.guardian.max_api_errors == 10
        assert "http://localhost:5173" in config.server.cors_origins

    def test_env_overrides_runtime_defaults(self, monkeypatch):
        monkeypatch.setenv("TRADING_MODE", "live")
        monkeypatch.setenv("NETWORK", "mainnet")
        monkeypatch.setenv("PAPER_USE_LIVE_MARKET_DATA", "true")
        monkeypatch.setenv("GUARDIAN_MAX_API_ERRORS", "7")
        monkeypatch.setenv("RATE_LIMIT_RPM", "333")
        monkeypatch.setenv("CORS_ORIGINS", "http://localhost:9000,http://localhost:9001")

        config = get_runtime_config()

        assert config.trading_mode == "live"
        assert config.network == "mainnet"
        assert config.paper.use_live_market_data is True
        assert config.guardian.max_api_errors == 7
        assert config.rate_limit_rpm == 333
        assert config.server.cors_origins == ["http://localhost:9000", "http://localhost:9001"]

    def test_paper_portfolio_default_balance_comes_from_runtime_config(self, monkeypatch):
        monkeypatch.delenv("PAPER_USE_LIVE_MARKET_DATA", raising=False)
        portfolio = PaperPortfolio()
        assert portfolio.get_balance("USDT") == 10000.0
