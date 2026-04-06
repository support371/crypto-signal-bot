"""
Tests for live mode routing, mainnet safety gate, and startup validation.

These tests verify that:
  - paper mode is always the safe default
  - live mode only activates with correct env + dependencies
  - mainnet requires ALLOW_MAINNET=true in addition to TRADING_MODE=live + NETWORK=mainnet
  - startup_checks raises on unguarded mainnet, warns cleanly on everything else
"""

import builtins
import os

import pytest
from fastapi.testclient import TestClient

import backend.app as app_module
from backend.app import app
from backend.logic.exchange_adapter import PaperAdapter, build_adapter
from backend.logic.paper_trading import PaperPortfolio, _synthetic_price
from backend.logic.startup_checks import run as run_startup_checks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _portfolio():
    p = PaperPortfolio()
    p.balances = {"USDT": 10000.0}
    return p


def _build(trading_mode, network="testnet", env_overrides=None):
    """Build adapter with optional env var overrides, restoring state after."""
    overrides = env_overrides or {}
    saved = {}
    try:
        for k, v in overrides.items():
            saved[k] = os.environ.get(k)
            os.environ[k] = v
        return build_adapter(trading_mode, network, _portfolio(), _synthetic_price)
    finally:
        for k, orig in saved.items():
            if orig is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = orig


# ---------------------------------------------------------------------------
# Adapter factory routing
# ---------------------------------------------------------------------------

class TestAdapterRouting:
    def test_paper_mode_always_paper(self):
        adapter = _build("paper", "testnet")
        assert adapter.mode == "paper"

    def test_paper_live_market_data_flag_still_uses_paper_adapter(self, monkeypatch):
        monkeypatch.setenv("PAPER_USE_LIVE_MARKET_DATA", "true")
        adapter = _build("paper", "testnet")
        assert adapter.mode == "paper"

    def test_paper_mode_network_ignored(self):
        adapter = _build("paper", "mainnet")
        assert adapter.mode == "paper"

    def test_live_no_key_falls_back_paper(self, monkeypatch):
        monkeypatch.delenv("BINANCE_API_KEY", raising=False)
        monkeypatch.delenv("BINANCE_API_SECRET", raising=False)
        adapter = _build("live", "testnet")
        assert adapter.mode == "paper"

    def test_live_partial_credentials_falls_back_paper(self, monkeypatch):
        monkeypatch.setenv("BINANCE_API_KEY", "only-key-no-secret")
        monkeypatch.delenv("BINANCE_API_SECRET", raising=False)
        adapter = _build("live", "testnet")
        assert adapter.mode == "paper"

    def test_live_no_ccxt_falls_back_paper(self, monkeypatch):
        monkeypatch.setenv("BINANCE_API_KEY", "fake-key")
        monkeypatch.setenv("BINANCE_API_SECRET", "fake-secret")
        original_import = builtins.__import__

        def mock_import(name, *args, **kwargs):
            if name == "ccxt":
                raise ImportError("ccxt not installed")
            return original_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", mock_import)
        adapter = _build("live", "testnet")
        assert adapter.mode == "paper"

    def test_unknown_mode_treated_as_non_live(self):
        adapter = _build("simulation", "testnet")
        assert adapter.mode == "paper"

    def test_adapter_mode_property_is_string(self):
        adapter = _build("paper")
        assert isinstance(adapter.mode, str)


# ---------------------------------------------------------------------------
# Mainnet safety gate
# ---------------------------------------------------------------------------

class TestMainnetGate:
    def test_mainnet_without_allow_flag_raises_when_adapter_would_be_mainnet(
        self, monkeypatch
    ):
        """
        If somehow a mainnet adapter is constructed (credentials + ccxt + mainnet),
        startup_checks must raise unless ALLOW_MAINNET=true.
        """
        monkeypatch.delenv("ALLOW_MAINNET", raising=False)
        with pytest.raises(RuntimeError, match="MAINNET BLOCKED"):
            run_startup_checks(
                trading_mode="live",
                network="mainnet",
                adapter_mode="mainnet",
            )

    def test_mainnet_with_allow_flag_does_not_raise(self, monkeypatch):
        monkeypatch.setenv("ALLOW_MAINNET", "true")
        # Should not raise — just log warnings
        run_startup_checks(
            trading_mode="live",
            network="mainnet",
            adapter_mode="mainnet",
        )

    def test_mainnet_allow_flag_case_insensitive(self, monkeypatch):
        monkeypatch.setenv("ALLOW_MAINNET", "TRUE")
        run_startup_checks(
            trading_mode="live",
            network="mainnet",
            adapter_mode="mainnet",
        )

    def test_mainnet_requested_but_adapter_fell_back_to_paper_no_raise(
        self, monkeypatch
    ):
        """
        When mainnet was requested but adapter fell back to paper (missing creds/ccxt),
        startup_checks must NOT raise — just warn. App is safe.
        """
        monkeypatch.delenv("ALLOW_MAINNET", raising=False)
        # adapter_mode='paper' means build_adapter already safe-guarded us
        run_startup_checks(
            trading_mode="live",
            network="mainnet",
            adapter_mode="paper",
        )

    def test_testnet_without_allow_mainnet_does_not_raise(self, monkeypatch):
        monkeypatch.delenv("ALLOW_MAINNET", raising=False)
        run_startup_checks(
            trading_mode="live",
            network="testnet",
            adapter_mode="testnet",
        )

    def test_paper_mode_never_raises_regardless_of_flags(self, monkeypatch):
        monkeypatch.delenv("ALLOW_MAINNET", raising=False)
        run_startup_checks(
            trading_mode="paper",
            network="mainnet",  # even if network says mainnet, paper mode is safe
            adapter_mode="paper",
        )


# ---------------------------------------------------------------------------
# Startup checks — credential and config warnings (smoke, no raise)
# ---------------------------------------------------------------------------

class TestStartupChecks:
    def test_paper_mode_runs_cleanly(self, monkeypatch):
        monkeypatch.delenv("BACKEND_API_KEY", raising=False)
        monkeypatch.delenv("BINANCE_API_KEY", raising=False)
        monkeypatch.delenv("BINANCE_API_SECRET", raising=False)
        run_startup_checks(trading_mode="paper", network="testnet", adapter_mode="paper")

    def test_live_testnet_with_no_credentials_runs_without_raise(self, monkeypatch):
        monkeypatch.delenv("BINANCE_API_KEY", raising=False)
        monkeypatch.delenv("BINANCE_API_SECRET", raising=False)
        # Adapter fell back to paper — should not raise
        run_startup_checks(trading_mode="live", network="testnet", adapter_mode="paper")

    def test_data_dirs_created(self, tmp_path, monkeypatch):
        audit_path = str(tmp_path / "data" / "audit.json")
        earnings_path = str(tmp_path / "data" / "earnings.json")
        monkeypatch.setenv("AUDIT_STORE_PATH", audit_path)
        monkeypatch.setenv("EARNINGS_STORE_PATH", earnings_path)
        run_startup_checks(trading_mode="paper", network="testnet", adapter_mode="paper")
        assert (tmp_path / "data").is_dir()

    def test_backend_api_key_set_no_warning_needed(self, monkeypatch):
        monkeypatch.setenv("BACKEND_API_KEY", "some-secret-key")
        # Should complete without raising
        run_startup_checks(trading_mode="paper", network="testnet", adapter_mode="paper")


class FakeMarketDataService:
    def __init__(self):
        self.started = False
        self.stopped = False

    async def start(self):
        self.started = True

    async def stop(self):
        self.stopped = True

    def get_snapshot(self, symbol):
        return None

    def get_status(self):
        return {
            "exchange": "binance",
            "market_data_mode": "live_public_paper",
            "connected": True,
            "connection_state": "streaming",
            "fallback_active": False,
            "last_update_ts": 1_700_000_000.0,
            "last_error": None,
            "stale": False,
            "symbols": ["BTCUSDT"],
            "source": "binance-public",
        }


class TestHybridPaperModeStartup:
    def test_hybrid_live_paper_mode_starts_market_data_service_and_keeps_paper_execution(self):
        original_mode = app_module.TRADING_MODE
        original_network = app_module.NETWORK
        original_live_market = app_module.PAPER_USE_LIVE_MARKET_DATA
        original_service = app_module.market_data_service
        original_adapter = app_module.exchange_adapter
        original_api_key = app_module.BACKEND_API_KEY

        fake_service = FakeMarketDataService()
        app_module.TRADING_MODE = "paper"
        app_module.NETWORK = "testnet"
        app_module.PAPER_USE_LIVE_MARKET_DATA = True
        app_module.BACKEND_API_KEY = ""
        app_module.market_data_service = fake_service
        app_module.exchange_adapter = build_adapter(
            trading_mode="paper",
            network="testnet",
            portfolio=app_module.paper_portfolio,
            synthetic_price_fn=_synthetic_price,
        )

        try:
            with TestClient(app) as client:
                assert fake_service.started is True
                status = client.get("/exchange/status")
                assert status.status_code == 200
                data = status.json()
                assert data["trading_mode"] == "paper"
                assert data["execution_mode"] == "paper"
                assert data["market_data_mode"] == "live_public_paper"
                assert data["paper_use_live_market_data"] is True
        finally:
            app_module.TRADING_MODE = original_mode
            app_module.NETWORK = original_network
            app_module.PAPER_USE_LIVE_MARKET_DATA = original_live_market
            app_module.market_data_service = original_service
            app_module.exchange_adapter = original_adapter
            app_module.BACKEND_API_KEY = original_api_key

        assert fake_service.stopped is True
