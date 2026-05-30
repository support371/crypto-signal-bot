"""Tests for the decision trace system."""

import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.models.decision_trace import (
    DecisionTrace,
    ExecutionSnapshot,
    GuardianSnapshot,
    RiskSnapshot,
    RuleTrace,
    SignalSnapshot,
)


class TestDecisionTraceModel:
    def test_default_construction(self):
        trace = DecisionTrace()
        assert trace.trace_id
        assert trace.intent_id == ""
        assert trace.symbol == ""
        assert trace.mode == "paper"
        assert isinstance(trace.signal, SignalSnapshot)
        assert isinstance(trace.risk, RiskSnapshot)
        assert isinstance(trace.execution, ExecutionSnapshot)
        assert isinstance(trace.guardian, GuardianSnapshot)

    def test_full_construction(self):
        trace = DecisionTrace(
            intent_id="test-123",
            symbol="BTCUSDT",
            side="BUY",
            quantity=0.1,
            price=43000.0,
            mode="paper",
            signal=SignalSnapshot(
                regime="TREND",
                direction="UP",
                confidence=0.85,
                horizon_minutes=15,
            ),
            risk=RiskSnapshot(
                approved=True,
                combined_size_multiplier=0.8,
                adjusted_quantity=0.08,
                rules_evaluated=[
                    RuleTrace(
                        rule_name="MaxPosition",
                        passed=True,
                        reason="Within limits",
                        size_multiplier=0.8,
                    ),
                ],
            ),
            execution=ExecutionSnapshot(
                status="FILLED",
                fill_price=43010.0,
                fill_quantity=0.08,
                slippage_pct=0.00023,
                adapter="paper",
            ),
            guardian=GuardianSnapshot(
                kill_switch_active=False,
                drawdown_pct=0.02,
                api_error_count=0,
                failed_order_count=0,
            ),
        )
        d = trace.to_dict()
        assert d["intent_id"] == "test-123"
        assert d["symbol"] == "BTCUSDT"
        assert d["signal"]["regime"] == "TREND"
        assert d["risk"]["approved"] is True
        assert d["risk"]["rules_evaluated"][0]["rule_name"] == "MaxPosition"
        assert d["execution"]["status"] == "FILLED"
        assert d["guardian"]["kill_switch_active"] is False

    def test_serialization_roundtrip(self):
        trace = DecisionTrace(
            intent_id="abc",
            symbol="ETHUSDT",
            side="SELL",
            quantity=1.0,
            price=2600.0,
        )
        d = trace.to_dict()
        restored = DecisionTrace(**d)
        assert restored.intent_id == trace.intent_id
        assert restored.symbol == trace.symbol
        assert restored.side == trace.side


class TestDecisionTraceAPI:
    @pytest.fixture(autouse=True)
    def setup(self):
        from backend.logic import context
        context.kill_switch_active = False
        context.kill_switch_reason = None
        context.guardian_triggered = False
        context.guardian_drawdown_pct = 0.0
        context.api_error_count = 0
        context.failed_order_count = 0
        context.latest_signal_by_symbol = {}
        from backend.logic.audit_store import clear_audit
        clear_audit()
        yield
        clear_audit()

    def test_traces_endpoint_empty(self):
        from backend.app import app
        client = TestClient(app)
        resp = client.get("/traces")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_trace_created_on_paper_buy(self):
        from backend.app import app
        client = TestClient(app)
        resp = client.post("/intent/paper", json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": 0.001,
        })
        assert resp.status_code == 200

        traces_resp = client.get("/traces")
        assert traces_resp.status_code == 200
        traces = traces_resp.json()
        assert len(traces) == 1

        trace = traces[0]
        assert trace["symbol"] == "BTCUSDT"
        assert trace["side"] == "BUY"
        assert trace["mode"] == "paper"
        assert "signal" in trace
        assert "risk" in trace
        assert "execution" in trace
        assert "guardian" in trace
        assert trace["execution"]["status"] in ("FILLED", "RISK_REJECTED", "FAILED")
        assert trace["trace_id"]
        assert trace["intent_id"]

    def test_trace_by_intent_id(self):
        from backend.app import app
        client = TestClient(app)
        resp = client.post("/intent/paper", json={
            "symbol": "ETHUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": 0.01,
        })
        intent_id = resp.json()["id"]

        trace_resp = client.get(f"/trace/{intent_id}")
        assert trace_resp.status_code == 200
        assert trace_resp.json()["intent_id"] == intent_id

    def test_trace_not_found(self):
        from backend.app import app
        client = TestClient(app)
        resp = client.get("/trace/nonexistent-id")
        assert resp.status_code == 404

    def test_traces_filter_by_symbol(self):
        from backend.app import app
        client = TestClient(app)
        client.post("/intent/paper", json={
            "symbol": "BTCUSDT", "side": "BUY",
            "order_type": "MARKET", "quantity": 0.001,
        })
        client.post("/intent/paper", json={
            "symbol": "ETHUSDT", "side": "BUY",
            "order_type": "MARKET", "quantity": 0.01,
        })

        btc_traces = client.get("/traces?symbol=BTCUSDT").json()
        assert len(btc_traces) == 1
        assert btc_traces[0]["symbol"] == "BTCUSDT"

    def test_trace_captures_risk_rules(self):
        from backend.app import app
        client = TestClient(app)
        resp = client.post("/intent/paper", json={
            "symbol": "BTCUSDT", "side": "BUY",
            "order_type": "MARKET", "quantity": 0.001,
        })
        traces = client.get("/traces").json()
        trace = traces[0]
        assert len(trace["risk"]["rules_evaluated"]) > 0
        for rule in trace["risk"]["rules_evaluated"]:
            assert "rule_name" in rule
            assert "passed" in rule
            assert "reason" in rule

    def test_trace_captures_guardian_state(self):
        from backend.logic import context
        context.kill_switch_active = False
        context.guardian_drawdown_pct = 0.015
        context.api_error_count = 2

        from backend.app import app
        client = TestClient(app)
        client.post("/intent/paper", json={
            "symbol": "BTCUSDT", "side": "BUY",
            "order_type": "MARKET", "quantity": 0.001,
        })
        traces = client.get("/traces").json()
        guardian = traces[0]["guardian"]
        assert guardian["kill_switch_active"] is False
        assert guardian["drawdown_pct"] == 0.015
        assert guardian["api_error_count"] == 2
