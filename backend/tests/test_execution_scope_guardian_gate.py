from unittest.mock import patch

import backend.app as app_module
from backend.models.execution_intent import IntentRequest, Side


def test_process_intent_rejects_killed_strategy_scope():
    req = IntentRequest(symbol="BTCUSDT", side=Side.BUY, quantity=0.001, strategy_id="alpha")

    with patch("backend.app.assert_scope_allowed", side_effect=app_module.TradingScopeHaltedError("Strategy 'alpha' is kill-switched.")):
        response = app_module._process_intent(req, "paper")

    assert response.status == "RISK_REJECTED"
    assert "kill-switched" in (response.notes or "")


def test_process_intent_checks_default_venue_scope_before_risk_engine():
    req = IntentRequest(symbol="BTCUSDT", side=Side.BUY, quantity=0.001, strategy_id="alpha")

    with patch("backend.app.assert_scope_allowed") as scope_allowed:
        with patch.object(app_module.risk_engine, "evaluate") as risk_evaluate:
            risk_evaluate.return_value.approved = False
            risk_evaluate.return_value.reason = "forced reject"
            risk_evaluate.return_value.to_dict.return_value = {"approved": False}
            response = app_module._process_intent(req, "paper")

    scope_allowed.assert_called_once()
    _, kwargs = scope_allowed.call_args
    assert kwargs["strategy_id"] == "alpha"
    assert kwargs["venue_id"] == app_module.EXCHANGE
    assert response.status == "RISK_REJECTED"
