"""
Tests for portfolio state persistence — restore_portfolio_state() and
_upsert_position() are called correctly after fills.
"""
import asyncio
import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_restore_no_op_on_empty_db():
    """restore_portfolio_state should not crash when DB tables are empty."""
    import backend.services.portfolio.service as svc

    mock_snap_row   = None  # no equity snapshot
    mock_pos_rows   = []
    mock_trade_rows = []

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__  = AsyncMock(return_value=False)

    async def mock_execute(stmt):
        result = MagicMock()
        result.scalar_one_or_none.return_value = mock_snap_row
        result.scalars.return_value.all.return_value = []
        return result

    mock_session.execute = mock_execute

    with patch("backend.db.session.get_session", return_value=mock_session):
        await svc.restore_portfolio_state("paper-test")

    # No crash, cash unchanged from module default
    assert float(svc._cash) > 0


@pytest.mark.asyncio
async def test_restore_sets_cash_from_snapshot():
    """restore_portfolio_state should set _cash from the latest equity snapshot."""
    import backend.services.portfolio.service as svc

    snap = MagicMock()
    snap.cash       = 9500.0
    snap.max_equity = 10200.0

    mock_session = AsyncMock()
    mock_session.__aenter__ = AsyncMock(return_value=mock_session)
    mock_session.__aexit__  = AsyncMock(return_value=False)

    call_count = [0]

    async def mock_execute(stmt):
        result = MagicMock()
        if call_count[0] == 0:
            result.scalar_one_or_none.return_value = snap
        else:
            result.scalars.return_value.all.return_value = []
            result.scalar_one_or_none.return_value = None
        call_count[0] += 1
        return result

    mock_session.execute = mock_execute

    with patch("backend.db.session.get_session", return_value=mock_session):
        await svc.restore_portfolio_state("paper-test-cash")

    assert float(svc._cash) == pytest.approx(9500.0)


@pytest.mark.asyncio
async def test_upsert_position_called_after_buy_fill():
    """_upsert_position is scheduled after a BUY order fills."""
    import backend.services.portfolio.service as svc
    from backend.services.market_data.service import MarketDataStale

    upsert_calls = []

    async def mock_upsert(symbol, account_id=None):
        upsert_calls.append(symbol)

    mock_snap = MagicMock(); mock_snap.price = "70000"

    # Approve all orders from the risk gate so we can test the fill path
    from backend.services.risk_gate.service import RiskGateDecision
    approved = RiskGateDecision(
        approved=True, order_qty=0.001, original_qty=0.001,
        size_multiplier=1.0, kill_switch=False,
        rules_passed=["test"], rules_failed=[],
        reasons=[], risk_score=0.0,
    )

    with (
        patch("backend.services.portfolio.service._upsert_position",
              side_effect=mock_upsert),
        patch("backend.services.market_data.service.get_price",
              new_callable=AsyncMock, return_value=mock_snap),
        patch("backend.services.portfolio.service._persist_order",
              new_callable=AsyncMock),
        patch("backend.services.portfolio.service._persist_trade",
              new_callable=AsyncMock),
        patch("backend.services.risk_gate.service.evaluate_order",
              new_callable=AsyncMock, return_value=approved),
    ):
        # Reset state
        svc._cash = Decimal("10000")
        svc._lots.clear()
        svc._orders.clear()
        svc._trades.clear()
        svc._trade_counter = 0

        order = await svc.submit_order(
            symbol="BTCUSDT", side="BUY",
            order_type="MARKET", qty=Decimal("0.001"),
        )

    # Flush pending tasks
    await asyncio.sleep(0)

    assert order.status == "FILLED"
    assert "BTCUSDT" in upsert_calls
