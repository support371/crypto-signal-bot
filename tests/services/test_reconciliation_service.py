# tests/services/test_reconciliation_service.py
"""
Tests for the reconciliation service.

Covers:
  - Clean reconciliation (no discrepancy)
  - Balance drift detection (changed balance, same trade count)
  - Tolerance: small drift below threshold is clean
  - P&L read failure returns discrepancy with error detail
  - Report caching and retrieval
  - First run (no prior report) is always clean
  - New trades reset drift detection
  - Result dataclass field population
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import backend.services.reconciliation.service as recon_svc


def _pnl_summary(
    realized=100.0, unrealized=50.0, trades=5,
):
    return SimpleNamespace(
        total_realized_pnl=realized,
        total_unrealized_pnl=unrealized,
        trade_count=trades,
    )


@pytest.fixture(autouse=True)
def reset_recon_state():
    recon_svc._last_report = None
    recon_svc._loop_running = False
    yield
    recon_svc._last_report = None


def _patch_pnl(
    balance=10000.0,
    summary=None,
    lots=None,
):
    if summary is None:
        summary = _pnl_summary()
    if lots is None:
        lots = {}

    return (
        patch(
            "backend.engine.pnl.get_pnl_summary",
            new_callable=AsyncMock,
            return_value=summary,
        ),
        patch(
            "backend.engine.pnl.get_usdt_balance",
            return_value=balance,
        ),
        patch(
            "backend.engine.pnl.get_all_lots",
            return_value=lots,
        ),
        patch(
            "backend.services.reconciliation.service"
            ".get_exchange_config",
            return_value=MagicMock(mode="paper"),
        ),
    )


class TestCleanReconciliation:
    @pytest.mark.asyncio
    async def test_first_run_is_clean(self):
        patches = _patch_pnl()
        with patches[0], patches[1], patches[2], patches[3]:
            result = await recon_svc.run_reconciliation()
        assert result.discrepancy_detected is False
        assert result.discrepancy_detail is None
        assert result.mode == "paper"

    @pytest.mark.asyncio
    async def test_stable_balance_is_clean(self):
        patches = _patch_pnl(balance=10000.0)
        with patches[0], patches[1], patches[2], patches[3]:
            await recon_svc.run_reconciliation()
            result = await recon_svc.run_reconciliation()
        assert result.discrepancy_detected is False

    @pytest.mark.asyncio
    async def test_balance_change_with_new_trades(self):
        """Balance changed but trade count also changed — not a drift."""
        summary1 = _pnl_summary(trades=5)
        summary2 = _pnl_summary(trades=6)

        p1 = _patch_pnl(balance=10000.0, summary=summary1)
        with p1[0], p1[1], p1[2], p1[3]:
            await recon_svc.run_reconciliation()

        p2 = _patch_pnl(balance=9950.0, summary=summary2)
        with p2[0], p2[1], p2[2], p2[3]:
            result = await recon_svc.run_reconciliation()

        assert result.discrepancy_detected is False


class TestDriftDetection:
    @pytest.mark.asyncio
    async def test_balance_drift_no_new_trades(self):
        """Balance changed with no new trades — discrepancy."""
        summary = _pnl_summary(trades=5)

        p1 = _patch_pnl(balance=10000.0, summary=summary)
        with p1[0], p1[1], p1[2], p1[3]:
            await recon_svc.run_reconciliation()

        p2 = _patch_pnl(balance=9990.0, summary=summary)
        with p2[0], p2[1], p2[2], p2[3]:
            result = await recon_svc.run_reconciliation()

        assert result.discrepancy_detected is True
        assert "drift" in result.discrepancy_detail.lower()
        assert "10.0000" in result.discrepancy_detail

    @pytest.mark.asyncio
    async def test_tiny_drift_below_threshold(self):
        """Drift <= 0.01 is within tolerance."""
        summary = _pnl_summary(trades=5)

        p1 = _patch_pnl(balance=10000.0, summary=summary)
        with p1[0], p1[1], p1[2], p1[3]:
            await recon_svc.run_reconciliation()

        p2 = _patch_pnl(balance=10000.005, summary=summary)
        with p2[0], p2[1], p2[2], p2[3]:
            result = await recon_svc.run_reconciliation()

        assert result.discrepancy_detected is False


class TestPnlReadFailure:
    @pytest.mark.asyncio
    async def test_pnl_error_returns_discrepancy(self):
        with (
            patch(
                "backend.engine.pnl.get_pnl_summary",
                new_callable=AsyncMock,
                side_effect=RuntimeError("DB down"),
            ),
            patch(
                "backend.engine.pnl.get_usdt_balance",
                side_effect=RuntimeError("DB down"),
            ),
            patch(
                "backend.engine.pnl.get_all_lots",
                side_effect=RuntimeError("DB down"),
            ),
            patch(
                "backend.services.reconciliation.service"
                ".get_exchange_config",
                return_value=MagicMock(mode="paper"),
            ),
        ):
            result = await recon_svc.run_reconciliation()

        assert result.discrepancy_detected is True
        assert "failure" in result.discrepancy_detail.lower()
        assert result.usdt_balance == 0.0


class TestReportCaching:
    @pytest.mark.asyncio
    async def test_report_cached_after_run(self):
        patches = _patch_pnl(balance=5000.0)
        with patches[0], patches[1], patches[2], patches[3]:
            await recon_svc.run_reconciliation()

        report = await recon_svc.get_latest_report()
        assert report is not None
        assert report["usdt_balance"] == 5000.0

    @pytest.mark.asyncio
    async def test_no_report_before_first_run(self):
        report = await recon_svc.get_latest_report()
        assert report is None


class TestResultFields:
    @pytest.mark.asyncio
    async def test_all_fields_populated(self):
        lots = {"BTCUSDT": [1, 2], "ETHUSDT": [3]}
        summary = _pnl_summary(
            realized=200.0, unrealized=75.0, trades=10,
        )
        patches = _patch_pnl(
            balance=8000.0, summary=summary, lots=lots,
        )
        with patches[0], patches[1], patches[2], patches[3]:
            result = await recon_svc.run_reconciliation()

        assert result.mode == "paper"
        assert result.usdt_balance == 8000.0
        assert result.total_realized_pnl == 200.0
        assert result.total_unrealized_pnl == 75.0
        assert result.open_lots_count == 3
        assert result.trade_count == 10
        assert result.created_at > 0
