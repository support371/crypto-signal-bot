# tests/routes/test_paper_reset.py
"""
Tests for POST /api/v1/paper/reset
"""
from __future__ import annotations
import pytest
from httpx import ASGITransport, AsyncClient
from backend.app import app


@pytest.fixture(autouse=True)
def reset_state_before():
    """Ensure a clean state before each test."""
    from decimal import Decimal
    from backend.services.portfolio.service import reset_portfolio
    from backend.services.signal_executor.service import _last_acted
    reset_portfolio(starting_cash=Decimal("10000"))
    _last_acted.clear()
    yield
    reset_portfolio(starting_cash=Decimal("10000"))
    _last_acted.clear()


@pytest.mark.asyncio
async def test_paper_reset_default_cash():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post("/api/v1/paper/reset", json={})
    assert resp.status_code == 200
    body = resp.json()
    assert body["reset"] is True
    assert body["starting_cash"] == 10000.0


@pytest.mark.asyncio
async def test_paper_reset_custom_cash():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post("/api/v1/paper/reset", json={"starting_cash": 5000.0, "reason": "test"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["starting_cash"] == 5000.0
    assert body["reason"] == "test"


@pytest.mark.asyncio
async def test_paper_reset_clears_portfolio():
    """After seeding a position directly, reset should wipe it."""
    from backend.services.portfolio.service import get_portfolio_summary
    import backend.services.portfolio.service as port_svc
    from decimal import Decimal

    # Seed state directly — no market data call needed
    from backend.services.portfolio.service import Lot
    port_svc._lots["ETHUSDT"].append(
        Lot(symbol="ETHUSDT", qty=Decimal("0.1"), entry_price=Decimal("3000"), opened_at=0, order_id="test-lot")
    )
    port_svc._cash -= Decimal("300")

    snap = await get_portfolio_summary()
    assert len(snap["open_positions"]) == 1

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post("/api/v1/paper/reset", json={})

    snap2 = await get_portfolio_summary()
    assert len(snap2["open_positions"]) == 0
    assert snap2["cash_balance"] == pytest.approx(10000.0)


@pytest.mark.asyncio
async def test_paper_reset_deactivates_kill_switch():
    """Reset should clear an active kill switch."""
    from backend.services.guardian_bot.service import (
        activate_kill_switch, get_guardian_status
    )
    await activate_kill_switch("Test trigger", "unit test")
    status = await get_guardian_status()
    assert status.kill_switch_active is True

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        resp = await c.post("/api/v1/paper/reset", json={})
    assert resp.status_code == 200

    status2 = await get_guardian_status()
    assert status2.kill_switch_active is False


@pytest.mark.asyncio
async def test_paper_reset_clears_executor_state():
    """Reset should clear signal executor last_acted cache."""
    from backend.services.signal_executor.service import _last_acted
    _last_acted["BTCUSDT"] = ("BUY", "combined")
    _last_acted["ETHUSDT"] = ("SELL", "momentum")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post("/api/v1/paper/reset", json={})

    assert len(_last_acted) == 0


@pytest.mark.asyncio
async def test_paper_reset_appears_in_console_status():
    """After reset, console/status shows fresh equity."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        await c.post("/api/v1/paper/reset", json={"starting_cash": 10000.0})
        resp = await c.get("/api/v1/console/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["portfolio"]["equity"] == 10000.0
    assert body["portfolio"]["cash_balance"] == 10000.0
    assert body["portfolio"]["positions"] == []
    assert body["guardian"]["kill_switch_active"] is False
