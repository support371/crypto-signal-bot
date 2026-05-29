"""
Tests for the 5 hardening layers:
1. Database persistence for portfolio state
2. Testnet validation with exchange API structure
3. Order reconciliation against exchange API
4. Mainnet gate enforcement
5. Retry logic for exchange API failures
"""

import os
import time
import pytest
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Layer 1: Portfolio persistence
# ---------------------------------------------------------------------------

def _init_test_db():
    """Create an in-memory SQLAlchemy engine for testing."""
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from sqlalchemy.pool import StaticPool
    from backend.db.models import Base
    import backend.db.session as db_session

    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    db_session._engine = engine
    db_session._session_factory = factory
    return engine


class TestPortfolioPersistence:
    """Test that portfolio state survives restarts via DB persistence."""

    @pytest.mark.asyncio
    async def test_save_and_load_balances(self):
        """Balances written via save_balances should be readable via load_balances."""
        from backend.db.session import close_db, get_session
        from backend.db.repositories.base import PortfolioRepository
        from backend.db.models import Base

        engine = _init_test_db()
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            async with get_session() as session:
                repo = PortfolioRepository(session)
                await repo.save_balances({"USDT": 9500.0, "BTC": 0.05}, mode="paper")
                await session.commit()

            async with get_session() as session:
                repo = PortfolioRepository(session)
                balances = await repo.load_balances(mode="paper")

            assert balances["USDT"] == 9500.0
            assert balances["BTC"] == 0.05
        finally:
            await close_db()

    @pytest.mark.asyncio
    async def test_save_removes_stale_assets(self):
        """Assets no longer in balances should be removed from DB."""
        from backend.db.session import close_db, get_session
        from backend.db.repositories.base import PortfolioRepository
        from backend.db.models import Base

        engine = _init_test_db()
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            async with get_session() as session:
                repo = PortfolioRepository(session)
                await repo.save_balances({"USDT": 9500.0, "BTC": 0.05}, mode="paper")
                await session.commit()

            async with get_session() as session:
                repo = PortfolioRepository(session)
                await repo.save_balances({"USDT": 10000.0}, mode="paper")
                await session.commit()

            async with get_session() as session:
                repo = PortfolioRepository(session)
                balances = await repo.load_balances(mode="paper")

            assert "BTC" not in balances
            assert balances["USDT"] == 10000.0
        finally:
            await close_db()

    @pytest.mark.asyncio
    async def test_restore_portfolio_with_saved_state(self):
        """restore_portfolio should replace in-memory balances with DB state."""
        from backend.db.session import close_db, get_session
        from backend.db.repositories.base import PortfolioRepository
        from backend.logic.paper_trading import PaperPortfolio
        from backend.services.portfolio_persistence import restore_portfolio
        from backend.db.models import Base

        engine = _init_test_db()
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            async with get_session() as session:
                repo = PortfolioRepository(session)
                await repo.save_balances({"USDT": 8000.0, "ETH": 2.5}, mode="paper")
                await session.commit()

            portfolio = PaperPortfolio(balances={"USDT": 10000.0})
            restored = await restore_portfolio(portfolio, mode="paper")

            assert restored is True
            assert portfolio.balances["USDT"] == 8000.0
            assert portfolio.balances["ETH"] == 2.5
        finally:
            await close_db()

    @pytest.mark.asyncio
    async def test_restore_portfolio_fresh_start(self):
        """restore_portfolio should return False when no saved state exists."""
        from backend.db.session import close_db
        from backend.logic.paper_trading import PaperPortfolio
        from backend.services.portfolio_persistence import restore_portfolio
        from backend.db.models import Base

        engine = _init_test_db()
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            portfolio = PaperPortfolio(balances={"USDT": 10000.0})
            restored = await restore_portfolio(portfolio, mode="paper")

            assert restored is False
            assert portfolio.balances["USDT"] == 10000.0
        finally:
            await close_db()

    @pytest.mark.asyncio
    async def test_persist_order_to_db(self):
        """persist_order should write order records to the orders table."""
        from backend.db.session import close_db, get_session
        from backend.db.repositories.base import OrderRepository
        from backend.services.portfolio_persistence import persist_order
        from backend.db.models import Base

        engine = _init_test_db()
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

            await persist_order({
                "id": "test-order-001",
                "symbol": "BTCUSDT",
                "side": "BUY",
                "order_type": "MARKET",
                "quantity": 0.01,
                "fill_price": 42000.0,
                "fill_quantity": 0.01,
                "status": "FILLED",
                "notes": "Paper fill",
            })

            async with get_session() as session:
                repo = OrderRepository(session)
                order = await repo.get_by_id("test-order-001")

            assert order is not None
            assert order.symbol == "BTCUSDT"
            assert order.side == "BUY"
            assert order.fill_price == 42000.0
            assert order.status == "FILLED"
        finally:
            await close_db()


# ---------------------------------------------------------------------------
# Layer 2: Testnet validation
# ---------------------------------------------------------------------------

class TestTestnetValidation:
    """Test exchange connectivity validation."""

    def test_paper_adapter_validation_passes(self):
        """Paper adapter should pass all validation checks."""
        from backend.services.testnet_validator import validate_exchange_connectivity
        from backend.logic.paper_trading import PaperPortfolio, _synthetic_price
        from backend.logic.exchange_adapter import PaperAdapter

        portfolio = PaperPortfolio(balances={"USDT": 10000.0})
        adapter = PaperAdapter(portfolio, _synthetic_price)
        result = validate_exchange_connectivity(adapter)

        assert result.passed is True
        assert result.exchange == "paper"
        assert result.mode == "paper"
        assert len(result.checks) == 4
        assert all(c["passed"] for c in result.checks)

    def test_failing_adapter_reports_errors(self):
        """Adapter that raises on get_price should fail validation."""
        from backend.services.testnet_validator import validate_exchange_connectivity

        adapter = MagicMock()
        adapter.exchange = "test_exchange"
        adapter.mode = "testnet"
        adapter.get_price.side_effect = ConnectionError("Network unreachable")
        adapter.get_balance.return_value = 100.0
        adapter.reconcile.return_value = {"balances": {"USDT": 100.0}}

        result = validate_exchange_connectivity(adapter)

        assert result.passed is False
        assert any("price_read" in c["name"] and not c["passed"] for c in result.checks)

    def test_validation_result_to_dict(self):
        """ValidationResult.to_dict() should produce a clean serializable dict."""
        from backend.services.testnet_validator import ValidationResult

        result = ValidationResult(
            exchange="binance",
            mode="testnet",
            passed=True,
            checks=[{"name": "price_read", "passed": True, "detail": "ok"}],
        )
        d = result.to_dict()
        assert d["exchange"] == "binance"
        assert d["passed"] is True
        assert len(d["checks"]) == 1


# ---------------------------------------------------------------------------
# Layer 3: Exchange reconciliation
# ---------------------------------------------------------------------------

class TestExchangeReconciliation:
    """Test order reconciliation against exchange API."""

    def test_reconciliation_no_drift(self):
        """When local and exchange balances match, no drift should be detected."""
        from backend.services.exchange_reconciler import reconcile_against_exchange

        adapter = MagicMock()
        adapter.reconcile.return_value = {
            "balances": {"USDT": "10000.0", "BTC": "0.05"},
        }

        result = reconcile_against_exchange(
            adapter=adapter,
            local_balances={"USDT": 10000.0, "BTC": 0.05},
        )

        assert result.status == "ok"
        assert result.drift_detected is False
        assert result.max_drift_pct == 0.0

    def test_reconciliation_detects_drift(self):
        """Significant balance difference should flag drift."""
        from backend.services.exchange_reconciler import reconcile_against_exchange

        adapter = MagicMock()
        adapter.reconcile.return_value = {
            "balances": {"USDT": "9000.0"},
        }

        result = reconcile_against_exchange(
            adapter=adapter,
            local_balances={"USDT": 10000.0},
            drift_tolerance_pct=1.0,
        )

        assert result.status == "drift_detected"
        assert result.drift_detected is True
        assert result.max_drift_pct > 1.0
        assert "USDT" in result.balance_drift

    def test_reconciliation_handles_exchange_error(self):
        """Exchange API failure should produce error status, not crash."""
        from backend.services.exchange_reconciler import reconcile_against_exchange

        adapter = MagicMock()
        adapter.reconcile.side_effect = ConnectionError("Exchange unreachable")

        result = reconcile_against_exchange(
            adapter=adapter,
            local_balances={"USDT": 10000.0},
        )

        assert result.status == "error"
        assert result.drift_detected is False

    def test_reconciliation_detects_missing_asset(self):
        """Asset present locally but not on exchange should show drift."""
        from backend.services.exchange_reconciler import reconcile_against_exchange

        adapter = MagicMock()
        adapter.reconcile.return_value = {
            "balances": {"USDT": "10000.0"},
        }

        result = reconcile_against_exchange(
            adapter=adapter,
            local_balances={"USDT": 10000.0, "BTC": 0.5},
            drift_tolerance_pct=1.0,
        )

        assert result.drift_detected is True
        assert "BTC" in result.balance_drift

    def test_reconciliation_result_to_dict(self):
        """ReconciliationResult.to_dict() should be JSON-serializable."""
        from backend.services.exchange_reconciler import ReconciliationResult
        import json

        result = ReconciliationResult(
            status="ok",
            local_balance={"USDT": 10000.0},
            exchange_balance={"USDT": 10000.0},
        )
        d = result.to_dict()
        serialized = json.dumps(d)
        assert "ok" in serialized


# ---------------------------------------------------------------------------
# Layer 4: Mainnet gate enforcement
# ---------------------------------------------------------------------------

class TestMainnetGate:
    """Test that mainnet execution is blocked without explicit opt-in."""

    def test_paper_mode_always_allowed(self):
        """Paper mode should never be blocked by mainnet gate."""
        from backend.engine.mainnet_gate import assert_not_mainnet
        assert_not_mainnet("mainnet", "paper")  # should not raise

    def test_testnet_live_mode_allowed(self):
        """Live mode on testnet should not be blocked."""
        from backend.engine.mainnet_gate import assert_not_mainnet
        assert_not_mainnet("testnet", "live")  # should not raise

    def test_mainnet_live_mode_blocked(self):
        """Live mode on mainnet should be blocked without ALLOW_MAINNET."""
        from backend.engine import mainnet_gate

        original = mainnet_gate._ALLOW_MAINNET
        mainnet_gate._ALLOW_MAINNET = False
        try:
            with pytest.raises(mainnet_gate.MainnetGateError) as exc_info:
                mainnet_gate.assert_not_mainnet("mainnet", "live")
            assert "ALLOW_MAINNET" in str(exc_info.value)
        finally:
            mainnet_gate._ALLOW_MAINNET = original

    def test_mainnet_live_mode_allowed_with_flag(self):
        """Live mode on mainnet should work when ALLOW_MAINNET is set."""
        from backend.engine import mainnet_gate

        original = mainnet_gate._ALLOW_MAINNET
        mainnet_gate._ALLOW_MAINNET = True
        try:
            mainnet_gate.assert_not_mainnet("mainnet", "live")  # should not raise
        finally:
            mainnet_gate._ALLOW_MAINNET = original

    def test_mainnet_status_endpoint(self):
        """mainnet_status() should return current gate state."""
        from backend.engine.mainnet_gate import mainnet_status

        status = mainnet_status()
        assert "mainnet_gate_active" in status
        assert "allow_mainnet" in status
        assert "note" in status

    def test_is_mainnet_allowed(self):
        """is_mainnet_allowed() should reflect the flag state."""
        from backend.engine import mainnet_gate

        original = mainnet_gate._ALLOW_MAINNET
        mainnet_gate._ALLOW_MAINNET = False
        assert mainnet_gate.is_mainnet_allowed() is False
        mainnet_gate._ALLOW_MAINNET = True
        assert mainnet_gate.is_mainnet_allowed() is True
        mainnet_gate._ALLOW_MAINNET = original


# ---------------------------------------------------------------------------
# Layer 5: Retry logic for exchange API failures
# ---------------------------------------------------------------------------

class TestExchangeRetry:
    """Test exponential backoff retry logic."""

    def test_succeeds_first_try(self):
        """Function that succeeds immediately should return normally."""
        from backend.services.exchange_retry import with_retry

        fn = MagicMock(return_value=42)
        result = with_retry(fn, max_retries=3)
        assert result == 42
        assert fn.call_count == 1

    def test_retries_on_transient_error(self):
        """Function that fails then succeeds should retry."""
        from backend.services.exchange_retry import with_retry

        fn = MagicMock(side_effect=[ConnectionError("fail"), ConnectionError("fail"), 42])
        result = with_retry(fn, max_retries=3, base_delay=0.01)
        assert result == 42
        assert fn.call_count == 3

    def test_raises_after_max_retries(self):
        """Function that always fails should raise after max retries."""
        from backend.services.exchange_retry import with_retry

        fn = MagicMock(side_effect=ConnectionError("always fails"))
        with pytest.raises(ConnectionError, match="always fails"):
            with_retry(fn, max_retries=2, base_delay=0.01)
        assert fn.call_count == 3  # initial + 2 retries

    def test_no_retry_on_auth_error(self):
        """AuthenticationError should not be retried."""
        from backend.services.exchange_retry import with_retry

        class AuthenticationError(Exception):
            pass

        fn = MagicMock(side_effect=AuthenticationError("bad key"))
        with pytest.raises(AuthenticationError):
            with_retry(fn, max_retries=3, base_delay=0.01)
        assert fn.call_count == 1  # no retries

    def test_no_retry_on_insufficient_funds(self):
        """InsufficientFunds should not be retried."""
        from backend.services.exchange_retry import with_retry

        class InsufficientFunds(Exception):
            pass

        fn = MagicMock(side_effect=InsufficientFunds("not enough"))
        with pytest.raises(InsufficientFunds):
            with_retry(fn, max_retries=3, base_delay=0.01)
        assert fn.call_count == 1

    def test_retryable_adapter_delegates_to_underlying(self):
        """RetryableAdapter should pass through to the underlying adapter."""
        from backend.services.exchange_retry import RetryableAdapter

        inner = MagicMock()
        inner.mode = "paper"
        inner.exchange = "binance"
        inner.get_price.return_value = 42000.0
        inner.get_balance.return_value = 10000.0

        adapter = RetryableAdapter(inner, max_retries=2, base_delay=0.01)

        assert adapter.get_price("BTCUSDT") == 42000.0
        assert adapter.get_balance("USDT") == 10000.0
        assert adapter.mode == "paper"
        assert adapter.exchange == "binance"
        inner.get_price.assert_called_once_with("BTCUSDT")
        inner.get_balance.assert_called_once_with("USDT")

    def test_retryable_adapter_retries_on_failure(self):
        """RetryableAdapter should retry transient failures."""
        from backend.services.exchange_retry import RetryableAdapter

        inner = MagicMock()
        inner.mode = "testnet"
        inner.exchange = "binance"
        inner.get_price.side_effect = [ConnectionError("timeout"), 42000.0]

        adapter = RetryableAdapter(inner, max_retries=2, base_delay=0.01)
        result = adapter.get_price("BTCUSDT")

        assert result == 42000.0
        assert inner.get_price.call_count == 2

    def test_retryable_adapter_place_order(self):
        """RetryableAdapter.place_order should pass kwargs correctly."""
        from backend.services.exchange_retry import RetryableAdapter

        inner = MagicMock()
        inner.mode = "paper"
        inner.exchange = "paper"
        inner.place_order.return_value = {"status": "FILLED"}

        adapter = RetryableAdapter(inner, max_retries=1, base_delay=0.01)
        result = adapter.place_order(symbol="BTCUSDT", side="BUY", order_type="MARKET", quantity=0.01)

        assert result["status"] == "FILLED"
        inner.place_order.assert_called_once_with(
            symbol="BTCUSDT", side="BUY", order_type="MARKET", quantity=0.01,
        )


# ---------------------------------------------------------------------------
# Integration: API endpoints for new hardening features
# ---------------------------------------------------------------------------

class TestHardeningEndpoints:
    """Test that new hardening endpoints are accessible."""

    @pytest.fixture(autouse=True)
    def setup_client(self):
        import backend.app as app_module
        from backend.logic import context as ctx
        from fastapi.testclient import TestClient

        self._original_api_key = app_module.BACKEND_API_KEY
        app_module.BACKEND_API_KEY = ""
        ctx.BACKEND_API_KEY = ""

        self.client = TestClient(app_module.app)
        yield

        app_module.BACKEND_API_KEY = self._original_api_key
        ctx.BACKEND_API_KEY = self._original_api_key

    def test_mainnet_gate_status(self):
        resp = self.client.get("/mainnet-gate/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "mainnet_gate_active" in data
        assert "allow_mainnet" in data

    def test_exchange_validate(self):
        resp = self.client.get("/exchange/validate")
        assert resp.status_code == 200
        data = resp.json()
        assert data["passed"] is True
        assert data["mode"] == "paper"

    def test_exchange_reconciliation(self):
        resp = self.client.get("/reconciliation/exchange")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "local_balance" in data
        assert "exchange_balance" in data
