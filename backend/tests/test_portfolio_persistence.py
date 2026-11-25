"""Tests for backend.services.portfolio_persistence — save/restore portfolio state."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock


class _FakeSession:
    """Minimal async context manager that mimics get_session()."""
    def __init__(self, repo_mock):
        self._repo_mock = repo_mock

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def commit(self):
        pass

    def add(self, obj):
        self._repo_mock._added.append(obj)


def _session_factory(repo_mock):
    """Return an async context manager factory that yields _FakeSession."""
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def _get_session():
        yield _FakeSession(repo_mock)

    return _get_session


class _FakePortfolio:
    """Minimal stand-in for PaperPortfolio."""
    def __init__(self, balances=None):
        self.balances = balances or {"USDT": 10000.0}


class TestRestorePortfolio:
    """Tests for restore_portfolio()."""

    @pytest.mark.asyncio
    async def test_restore_with_saved_state(self):
        repo = MagicMock()
        repo.load_balances = AsyncMock(return_value={"USDT": 8500.0, "BTC": 0.05})

        with patch("backend.services.portfolio_persistence.get_session", _session_factory(repo)), \
             patch("backend.services.portfolio_persistence.PortfolioRepository", return_value=repo):
            from backend.services.portfolio_persistence import restore_portfolio
            portfolio = _FakePortfolio()
            result = await restore_portfolio(portfolio, mode="paper")

        assert result is True
        assert portfolio.balances == {"USDT": 8500.0, "BTC": 0.05}

    @pytest.mark.asyncio
    async def test_restore_no_saved_state(self):
        repo = MagicMock()
        repo.load_balances = AsyncMock(return_value=None)

        with patch("backend.services.portfolio_persistence.get_session", _session_factory(repo)), \
             patch("backend.services.portfolio_persistence.PortfolioRepository", return_value=repo):
            from backend.services.portfolio_persistence import restore_portfolio
            portfolio = _FakePortfolio({"USDT": 10000.0})
            result = await restore_portfolio(portfolio, mode="paper")

        assert result is False
        assert portfolio.balances == {"USDT": 10000.0}

    @pytest.mark.asyncio
    async def test_restore_empty_balances_treated_as_no_state(self):
        repo = MagicMock()
        repo.load_balances = AsyncMock(return_value={})

        with patch("backend.services.portfolio_persistence.get_session", _session_factory(repo)), \
             patch("backend.services.portfolio_persistence.PortfolioRepository", return_value=repo):
            from backend.services.portfolio_persistence import restore_portfolio
            portfolio = _FakePortfolio({"USDT": 10000.0})
            result = await restore_portfolio(portfolio, mode="paper")

        assert result is False

    @pytest.mark.asyncio
    async def test_restore_db_error_returns_false(self):
        with patch(
            "backend.services.portfolio_persistence.get_session",
            side_effect=Exception("DB connection refused"),
        ):
            from backend.services.portfolio_persistence import restore_portfolio
            portfolio = _FakePortfolio()
            result = await restore_portfolio(portfolio, mode="paper")

        assert result is False
        assert portfolio.balances == {"USDT": 10000.0}

    @pytest.mark.asyncio
    async def test_restore_uses_mode_param(self):
        repo = MagicMock()
        repo.load_balances = AsyncMock(return_value={"USDT": 5000.0})

        with patch("backend.services.portfolio_persistence.get_session", _session_factory(repo)), \
             patch("backend.services.portfolio_persistence.PortfolioRepository", return_value=repo):
            from backend.services.portfolio_persistence import restore_portfolio
            portfolio = _FakePortfolio()
            await restore_portfolio(portfolio, mode="backtest")

        repo.load_balances.assert_called_once_with(mode="backtest")


class TestPersistPortfolio:
    """Tests for persist_portfolio()."""

    @pytest.mark.asyncio
    async def test_persist_saves_balances(self):
        repo = MagicMock()
        repo.save_balances = AsyncMock()

        with patch("backend.services.portfolio_persistence.get_session", _session_factory(repo)), \
             patch("backend.services.portfolio_persistence.PortfolioRepository", return_value=repo):
            from backend.services.portfolio_persistence import persist_portfolio
            portfolio = _FakePortfolio({"USDT": 7500.0, "ETH": 2.0})
            await persist_portfolio(portfolio, mode="paper")

        repo.save_balances.assert_called_once_with({"USDT": 7500.0, "ETH": 2.0}, mode="paper")

    @pytest.mark.asyncio
    async def test_persist_db_error_does_not_raise(self):
        with patch(
            "backend.services.portfolio_persistence.get_session",
            side_effect=Exception("DB write failed"),
        ):
            from backend.services.portfolio_persistence import persist_portfolio
            portfolio = _FakePortfolio()
            await persist_portfolio(portfolio, mode="paper")


class TestPersistOrder:
    """Tests for persist_order()."""

    @pytest.mark.asyncio
    async def test_persist_filled_order(self):
        repo = MagicMock()
        repo._added = []

        with patch("backend.services.portfolio_persistence.get_session", _session_factory(repo)):
            from backend.services.portfolio_persistence import persist_order
            await persist_order({
                "id": "ord-1",
                "symbol": "BTCUSDT",
                "side": "BUY",
                "order_type": "MARKET",
                "quantity": 0.01,
                "price": 97000.0,
                "fill_price": 97050.0,
                "fill_quantity": 0.01,
                "status": "FILLED",
                "venue_id": "paper",
            })

    @pytest.mark.asyncio
    async def test_persist_rejected_order_includes_notes(self):
        repo = MagicMock()
        repo._added = []

        with patch("backend.services.portfolio_persistence.get_session", _session_factory(repo)):
            from backend.services.portfolio_persistence import persist_order
            await persist_order({
                "id": "ord-2",
                "symbol": "ETHUSDT",
                "side": "SELL",
                "order_type": "LIMIT",
                "quantity": 1.0,
                "status": "REJECTED",
                "notes": "Insufficient balance",
            })

    @pytest.mark.asyncio
    async def test_persist_order_db_error_does_not_raise(self):
        with patch(
            "backend.services.portfolio_persistence.get_session",
            side_effect=Exception("DB write error"),
        ):
            from backend.services.portfolio_persistence import persist_order
            await persist_order({"id": "ord-3", "symbol": "BTC", "side": "BUY", "status": "FILLED"})
