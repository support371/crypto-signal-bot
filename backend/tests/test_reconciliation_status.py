"""Regression tests for reconciliation status endpoint."""

from fastapi.testclient import TestClient

import backend.services.reconciliation.service as reconciliation_service
from backend.app import app


def test_reconciliation_status_returns_no_report_when_reconciliation_has_not_run():
    reconciliation_service._last_report = None
    client = TestClient(app)

    response = client.get("/reconciliation/status")

    assert response.status_code == 200
    assert response.json() == {
        "status": "no_report",
        "message": "Reconciliation has not run yet.",
    }


def test_reconciliation_status_returns_latest_report():
    reconciliation_service._last_report = {
        "usdt_balance": 10000.0,
        "total_realized_pnl": 125.5,
        "trade_count": 3,
        "created_at": 1_700_000_000,
    }
    client = TestClient(app)

    response = client.get("/reconciliation/status")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["report"] == reconciliation_service._last_report
