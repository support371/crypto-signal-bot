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
