from backend.engine.risk_rules import PortfolioExposureRule, RiskRuleEngine
from backend.models.risk import RiskContext


def test_portfolio_exposure_rule_rejects_above_total_cap():
    rule = PortfolioExposureRule(max_total_exposure_pct=0.5)
    ctx = RiskContext(
        symbol="BTCUSDT",
        side="BUY",
        quantity=1,
        price=1000,
        current_position_value=1000,
        current_total_exposure=4500,
        account_balance=10000,
    )

    result = rule.evaluate(ctx)

    assert result.passed is False
    assert "Portfolio exposure" in result.reason


def test_portfolio_exposure_rule_reduces_size_near_cap():
    rule = PortfolioExposureRule(max_total_exposure_pct=0.5)
    ctx = RiskContext(
        symbol="BTCUSDT",
        side="BUY",
        quantity=0.25,
        price=1000,
        current_position_value=500,
        current_total_exposure=4250,
        account_balance=10000,
    )

    result = rule.evaluate(ctx)

    assert result.passed is True
    assert result.size_multiplier < 1.0
    assert "reducing size" in result.reason


def test_risk_engine_includes_portfolio_exposure_rule():
    engine = RiskRuleEngine(
        max_position_pct=1.0,
        max_total_exposure_pct=0.5,
        max_daily_loss_pct=1.0,
        volatility_threshold=1.0,
        max_leverage=10.0,
        max_slippage_pct=1.0,
    )
    ctx = RiskContext(
        symbol="ETHUSDT",
        side="BUY",
        quantity=1,
        price=1000,
        current_position_value=1000,
        current_total_exposure=4600,
        account_balance=10000,
    )

    result = engine.evaluate(ctx)

    assert result.approved is False
    assert "PortfolioExposure" in result.reason
