"""
Unit tests for the Intent Builder.
"""
import pytest
from backend.contracts.schemas import Signal, MarketPosture, PortfolioState
from backend.intents.builder import RiskConfig, build_intent

@pytest.fixture
def base_config() -> RiskConfig:
    return RiskConfig(
        max_gross_exposure=1.0,
        max_symbol_exposure=0.5,
        base_sizing_fraction=0.1,
        amber_size_reduction=0.5
    )

@pytest.fixture
def empty_portfolio() -> PortfolioState:
    return PortfolioState(nav=10000, exposure=0.0, positions={}, balances={"USDT": 10000}, drawdown=0.0)

@pytest.fixture
def long_portfolio() -> PortfolioState:
    return PortfolioState(nav=10000, exposure=0.2, positions={"BTC/USDT": 0.2}, balances={"USDT": 8000}, drawdown=0.0)

@pytest.fixture
def green_posture() -> MarketPosture:
    return MarketPosture(status="GREEN", reasons=["Signal is clear and data is fresh."])

@pytest.fixture
def amber_posture() -> MarketPosture:
    return MarketPosture(status="AMBER", reasons=["Market regime is 'CHAOS'."])

@pytest.fixture
def red_posture() -> MarketPosture:
    return MarketPosture(status="RED", reasons=["Market data is stale or gapped."])

@pytest.fixture
def strong_up_signal() -> Signal:
    return Signal(direction="UP", confidence=0.8, regime="TREND", horizon_minutes=15)

@pytest.fixture
def strong_down_signal() -> Signal:
    return Signal(direction="DOWN", confidence=0.8, regime="TREND", horizon_minutes=15)

def test_red_posture_blocks_new_entry(strong_up_signal, red_posture, empty_portfolio, base_config):
    intent = build_intent(strong_up_signal, red_posture, empty_portfolio, base_config, "BTC/USDT")
    assert intent.action == "HOLD"
    assert "RED POSTURE" in intent.reason
    assert intent.size_fraction == 0.0

def test_green_posture_generates_enter_long(strong_up_signal, green_posture, empty_portfolio, base_config):
    intent = build_intent(strong_up_signal, green_posture, empty_portfolio, base_config, "BTC/USDT")
    assert intent.action == "ENTER_LONG"
    assert intent.size_fraction == base_config.base_sizing_fraction
    assert "GREEN POSTURE" in intent.reason

def test_amber_posture_reduces_size(strong_up_signal, amber_posture, empty_portfolio, base_config):
    intent = build_intent(strong_up_signal, amber_posture, empty_portfolio, base_config, "BTC/USDT")
    assert intent.action == "ENTER_LONG"
    expected_size = base_config.base_sizing_fraction * base_config.amber_size_reduction
    assert intent.size_fraction == pytest.approx(expected_size)
    assert "AMBER POSTURE" in intent.reason

def test_down_signal_generates_reduce_intent(strong_down_signal, green_posture, long_portfolio, base_config):
    intent = build_intent(strong_down_signal, green_posture, long_portfolio, base_config, "BTC/USDT")
    assert intent.action == "REDUCE"
    assert intent.size_fraction == base_config.base_sizing_fraction

def test_sizing_is_deterministic(strong_up_signal, green_posture, empty_portfolio, base_config):
    intent1 = build_intent(strong_up_signal, green_posture, empty_portfolio, base_config, "BTC/USDT")
    intent2 = build_intent(strong_up_signal, green_posture, empty_portfolio, base_config, "BTC/USDT")

    assert intent1.action == intent2.action
    assert intent1.size_fraction == intent2.size_fraction
    assert intent1.reason == intent2.reason

def test_gross_exposure_limit_blocks_entry(strong_up_signal, green_posture, long_portfolio, base_config):
    config = base_config.model_copy(update={"max_gross_exposure": 0.25})
    intent = build_intent(strong_up_signal, green_posture, long_portfolio, config, "ETH/USDT")

    assert intent.action == "HOLD"
    assert "Gross exposure limit" in intent.reason

def test_symbol_exposure_limit_blocks_entry(strong_up_signal, green_posture, long_portfolio, base_config):
    config = base_config.model_copy(update={"max_symbol_exposure": 0.25})
    intent = build_intent(strong_up_signal, green_posture, long_portfolio, config, "BTC/USDT")

    assert intent.action == "HOLD"
    assert "Symbol exposure limit" in intent.reason
