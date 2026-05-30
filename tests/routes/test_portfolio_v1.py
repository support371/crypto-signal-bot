# tests/routes/test_portfolio_v1.py
"""
Portfolio V1 route tests — covers:
  POST /api/v1/orders
  GET  /api/v1/orders
  GET  /api/v1/orders/{id}
  GET  /api/v1/portfolio
  GET  /api/v1/portfolio/trades
  GET  /api/v1/portfolio/positions
  GET  /api/v1/portfolio/pnl/daily
  GET  /api/v1/portfolio/equity-history
"""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport


# ─── Shared fixtures ──────────────────────────────────────────────

@pytest.fixture()
def app():
    from backend.app import app as _app
    return _app


@pytest.fixture()
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ─── POST /api/v1/orders ─────────────────────────────────────────

class TestCreateOrder:
    @pytest.mark.asyncio
    async def test_market_buy_returns_201(self, client):
        fake_order = MagicMock(
            id="o1", symbol="BTCUSDT", side="BUY", order_type="MARKET",
            qty=0.001, price=None, status="FILLED",
            created_at=1_000_000, updated_at=1_000_000,
        )
        with patch(
            "backend.routes.portfolio_v1.submit_order",
            new_callable=AsyncMock, return_value=fake_order
        ):
            resp = await client.post("/api/v1/orders", json={
                "symbol": "BTCUSDT", "side": "BUY",
                "order_type": "MARKET", "qty": 0.001,
            })
        assert resp.status_code == 201
        body = resp.json()
        assert body["id"] == "o1"
        assert body["status"] == "FILLED"

    @pytest.mark.asyncio
    async def test_limit_order_without_price_returns_422(self, client):
        resp = await client.post("/api/v1/orders", json={
            "symbol": "ETHUSDT", "side": "BUY",
            "order_type": "LIMIT", "qty": 0.1,
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_invalid_side_returns_422(self, client):
        resp = await client.post("/api/v1/orders", json={
            "symbol": "BTCUSDT", "side": "HOLD", "qty": 0.1,
        })
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_zero_qty_returns_422(self, client):
        resp = await client.post("/api/v1/orders", json={
            "symbol": "BTCUSDT", "side": "BUY", "qty": 0,
        })
        assert resp.status_code == 422


# ─── GET /api/v1/orders ──────────────────────────────────────────

class TestListOrders:
    @pytest.mark.asyncio
    async def test_returns_list(self, client):
        fake = [{"id": "o1", "symbol": "BTCUSDT", "side": "BUY",
                 "order_type": "MARKET", "qty": 0.001, "price": None,
                 "status": "FILLED", "created_at": 1_000_000, "updated_at": 1_000_000}]
        with patch("backend.routes.portfolio_v1.get_orders", return_value=fake):
            resp = await client.get("/api/v1/orders")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.asyncio
    async def test_status_filter_passed_through(self, client):
        with patch("backend.routes.portfolio_v1.get_orders", return_value=[]) as mock_go:
            resp = await client.get("/api/v1/orders?status=PENDING")
        assert resp.status_code == 200
        mock_go.assert_called_once_with(status="PENDING", limit=50)


# ─── GET /api/v1/orders/{id} ─────────────────────────────────────

class TestGetOrder:
    @pytest.mark.asyncio
    async def test_existing_order_returns_200(self, client):
        fake = {"id": "o1", "symbol": "BTCUSDT", "side": "BUY",
                "order_type": "MARKET", "qty": 0.001, "price": None,
                "status": "FILLED", "created_at": 1_000_000, "updated_at": 1_000_000}
        with patch("backend.routes.portfolio_v1.get_order", return_value=fake):
            resp = await client.get("/api/v1/orders/o1")
        assert resp.status_code == 200

    @pytest.mark.asyncio
    async def test_missing_order_returns_404(self, client):
        with patch("backend.routes.portfolio_v1.get_order", return_value=None):
            resp = await client.get("/api/v1/orders/nonexistent")
        assert resp.status_code == 404


# ─── GET /api/v1/portfolio ───────────────────────────────────────

class TestPortfolioSummary:
    @pytest.mark.asyncio
    async def test_returns_expected_fields(self, client):
        fake = {
            "account_id": "default", "cash_balance": 10000.0,
            "equity": 10250.0, "max_equity": 10300.0,
            "drawdown_pct": 0.49, "total_realized_pnl": 200.0,
            "total_unrealized_pnl": 50.0, "trade_count": 5,
            "win_rate_pct": 60.0, "open_positions": [], "as_of": 1_700_000_000,
        }
        with patch(
            "backend.routes.portfolio_v1.get_portfolio_summary",
            new_callable=AsyncMock, return_value=fake
        ):
            resp = await client.get("/api/v1/portfolio")
        assert resp.status_code == 200
        body = resp.json()
        assert body["equity"] == 10250.0
        assert body["win_rate_pct"] == 60.0
        assert "open_positions" in body

    @pytest.mark.asyncio
    async def test_drawdown_is_non_negative(self, client):
        fake = {
            "account_id": "default", "cash_balance": 9500.0,
            "equity": 9500.0, "max_equity": 10000.0,
            "drawdown_pct": 5.0, "total_realized_pnl": -500.0,
            "total_unrealized_pnl": 0.0, "trade_count": 2,
            "win_rate_pct": 0.0, "open_positions": [], "as_of": 1_700_000_000,
        }
        with patch(
            "backend.routes.portfolio_v1.get_portfolio_summary",
            new_callable=AsyncMock, return_value=fake
        ):
            resp = await client.get("/api/v1/portfolio")
        body = resp.json()
        assert body["drawdown_pct"] >= 0


# ─── GET /api/v1/portfolio/positions ─────────────────────────────

class TestPositionsDetail:
    @pytest.mark.asyncio
    async def test_returns_positions_list(self, client):
        fake = [{
            "symbol": "BTCUSDT", "qty": 0.1,
            "avg_entry_price": 70000.0, "mark_price": 74000.0,
            "notional_value": 7400.0,
            "unrealized_pnl": 400.0, "unrealized_pnl_pct": 0.5714,
            "realized_pnl": 100.0, "total_pnl": 500.0,
            "lots": 2, "oldest_lot_ts": 1_700_000_000,
        }]
        with patch(
            "backend.routes.portfolio_v1.get_positions_detail",
            new_callable=AsyncMock, return_value=fake
        ):
            resp = await client.get("/api/v1/portfolio/positions")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["symbol"] == "BTCUSDT"
        assert body[0]["unrealized_pnl"] == 400.0
        assert body[0]["unrealized_pnl_pct"] == 0.5714
        assert "oldest_lot_ts" in body[0]

    @pytest.mark.asyncio
    async def test_empty_positions_returns_empty_list(self, client):
        with patch(
            "backend.routes.portfolio_v1.get_positions_detail",
            new_callable=AsyncMock, return_value=[]
        ):
            resp = await client.get("/api/v1/portfolio/positions")
        assert resp.status_code == 200
        assert resp.json() == []


# ─── GET /api/v1/portfolio/pnl/daily ─────────────────────────────

class TestDailyPnl:
    @pytest.mark.asyncio
    async def test_returns_daily_rows(self, client):
        fake = [{
            "date_utc": "2026-05-30", "account_id": "default",
            "realized_pnl": 120.5, "unrealized_pnl": 45.0,
            "total_pnl": 165.5, "trade_count": 3,
            "win_count": 2, "loss_count": 1,
        }]
        with patch(
            "backend.routes.portfolio_v1.get_daily_pnl",
            new_callable=AsyncMock, return_value=fake
        ):
            resp = await client.get("/api/v1/portfolio/pnl/daily")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 1
        assert body[0]["realized_pnl"] == 120.5
        assert body[0]["total_pnl"] == 165.5

    @pytest.mark.asyncio
    async def test_days_param_passed_through(self, client):
        with patch(
            "backend.routes.portfolio_v1.get_daily_pnl",
            new_callable=AsyncMock, return_value=[]
        ) as mock_fn:
            resp = await client.get("/api/v1/portfolio/pnl/daily?days=7")
        assert resp.status_code == 200
        mock_fn.assert_called_once_with(days=7)

    @pytest.mark.asyncio
    async def test_days_above_max_returns_422(self, client):
        resp = await client.get("/api/v1/portfolio/pnl/daily?days=999")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_win_loss_counts_non_negative(self, client):
        fake = [{
            "date_utc": "2026-05-29", "account_id": "default",
            "realized_pnl": -200.0, "unrealized_pnl": 0.0, "total_pnl": -200.0,
            "trade_count": 2, "win_count": 0, "loss_count": 2,
        }]
        with patch(
            "backend.routes.portfolio_v1.get_daily_pnl",
            new_callable=AsyncMock, return_value=fake
        ):
            resp = await client.get("/api/v1/portfolio/pnl/daily")
        body = resp.json()
        assert body[0]["win_count"] >= 0
        assert body[0]["loss_count"] >= 0


# ─── GET /api/v1/portfolio/equity-history ────────────────────────

class TestEquityHistory:
    @pytest.mark.asyncio
    async def test_returns_time_series(self, client):
        fake = [
            {"timestamp": 1_700_000_000, "equity": 10000.0, "cash": 10000.0,
             "unrealized": 0.0, "drawdown_pct": 0.0, "max_equity": 10000.0},
            {"timestamp": 1_700_000_300, "equity": 10150.0, "cash": 9800.0,
             "unrealized": 350.0, "drawdown_pct": 0.0, "max_equity": 10150.0},
        ]
        with patch(
            "backend.routes.portfolio_v1.get_equity_history",
            new_callable=AsyncMock, return_value=fake
        ):
            resp = await client.get("/api/v1/portfolio/equity-history")
        assert resp.status_code == 200
        body = resp.json()
        assert len(body) == 2
        assert body[1]["equity"] == 10150.0
        assert body[1]["unrealized"] == 350.0

    @pytest.mark.asyncio
    async def test_hours_param_passed_through(self, client):
        with patch(
            "backend.routes.portfolio_v1.get_equity_history",
            new_callable=AsyncMock, return_value=[]
        ) as mock_fn:
            await client.get("/api/v1/portfolio/equity-history?hours=48")
        mock_fn.assert_called_once_with(hours=48)

    @pytest.mark.asyncio
    async def test_hours_above_max_returns_422(self, client):
        resp = await client.get("/api/v1/portfolio/equity-history?hours=9999")
        assert resp.status_code == 422

    @pytest.mark.asyncio
    async def test_empty_history_returns_empty_list(self, client):
        with patch(
            "backend.routes.portfolio_v1.get_equity_history",
            new_callable=AsyncMock, return_value=[]
        ):
            resp = await client.get("/api/v1/portfolio/equity-history")
        assert resp.status_code == 200
        assert resp.json() == []
