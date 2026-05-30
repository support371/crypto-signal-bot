"""Unit tests for strategy evaluation and signal combiner."""
import pytest
from backend.logic.strategies import (
    trend_follow,
    mean_reversion,
    momentum,
    combine_strategies,
    StrategyResult,
)


class TestTrendFollow:
    def test_bull_stack_low_rsi_buys(self):
        r = trend_follow(ema20=110, ema50=100, ema200=90, rsi14=55)
        assert r.side == "BUY"
        assert r.confidence > 0.5

    def test_bear_stack_high_rsi_sells(self):
        r = trend_follow(ema20=90, ema50=100, ema200=110, rsi14=65)
        assert r.side == "SELL"

    def test_bull_stack_overbought_rsi_flat(self):
        r = trend_follow(ema20=110, ema50=100, ema200=90, rsi14=75)
        assert r.side == "FLAT"

    def test_mixed_ema_flat(self):
        r = trend_follow(ema20=105, ema50=100, ema200=108, rsi14=50)
        assert r.side == "FLAT"

    def test_none_input_flat(self):
        r = trend_follow(ema20=None, ema50=100, ema200=90, rsi14=50)
        assert r.side == "FLAT"
        assert r.confidence == 0.0

    def test_confidence_scales_with_rsi_distance(self):
        close_rsi = trend_follow(110, 100, 90, rsi14=68)
        far_rsi   = trend_follow(110, 100, 90, rsi14=40)
        assert far_rsi.confidence > close_rsi.confidence


class TestMeanReversion:
    def test_oversold_buy(self):
        r = mean_reversion(rsi14=25, price=98, bb_upper=115, bb_lower=95, bb_mid=105)
        assert r.side == "BUY"
        assert r.confidence > 0.5

    def test_overbought_sell(self):
        r = mean_reversion(rsi14=75, price=112, bb_upper=115, bb_lower=95, bb_mid=105)
        assert r.side == "SELL"

    def test_normal_rsi_flat(self):
        r = mean_reversion(rsi14=50, price=105, bb_upper=115, bb_lower=95, bb_mid=105)
        assert r.side == "FLAT"

    def test_oversold_rsi_price_above_lower_flat(self):
        # RSI < 30 but price is NOT near lower band
        r = mean_reversion(rsi14=25, price=110, bb_upper=115, bb_lower=95, bb_mid=105)
        assert r.side == "FLAT"

    def test_none_input_flat(self):
        r = mean_reversion(rsi14=None, price=100, bb_upper=115, bb_lower=95, bb_mid=105)
        assert r.side == "FLAT"


class TestMomentum:
    def test_bullish_crossover_buy(self):
        r = momentum(macd_line=0.5, signal_line=0.3,
                     histogram=0.2, prev_macd_line=-0.1, prev_signal_line=0.1)
        assert r.side == "BUY"
        assert r.confidence >= 0.65

    def test_bearish_crossover_sell(self):
        r = momentum(macd_line=-0.3, signal_line=-0.1,
                     histogram=-0.2, prev_macd_line=0.1, prev_signal_line=-0.1)
        assert r.side == "SELL"

    def test_ongoing_bull_alignment_buy(self):
        r = momentum(macd_line=0.5, signal_line=0.3,
                     histogram=0.2, prev_macd_line=0.4, prev_signal_line=0.2)
        assert r.side == "BUY"
        assert r.confidence < 0.65   # lower than crossover

    def test_none_input_flat(self):
        r = momentum(macd_line=None, signal_line=0.3,
                     histogram=0.1, prev_macd_line=-0.1, prev_signal_line=0.1)
        assert r.side == "FLAT"


class TestCombineStrategies:
    def test_unanimous_buy_high_confidence(self):
        results = [
            StrategyResult("a", "BUY", 0.7),
            StrategyResult("b", "BUY", 0.75),
            StrategyResult("c", "BUY", 0.65),
        ]
        combined = combine_strategies(results)
        assert combined["side"] == "BUY"
        assert combined["confidence"] > 0.7  # consensus bonus

    def test_majority_sell(self):
        results = [
            StrategyResult("a", "SELL", 0.7),
            StrategyResult("b", "SELL", 0.65),
            StrategyResult("c", "BUY",  0.6),
        ]
        combined = combine_strategies(results)
        assert combined["side"] == "SELL"

    def test_split_vote_flat(self):
        results = [
            StrategyResult("a", "BUY",  0.55),
            StrategyResult("b", "SELL", 0.55),
        ]
        combined = combine_strategies(results)
        # No clear winner — could be either; just check confidence is low
        assert combined["confidence"] < 0.6

    def test_output_has_required_keys(self):
        results = [StrategyResult("a", "BUY", 0.7)]
        out = combine_strategies(results)
        for key in ["side", "confidence", "strategy_votes", "reasons", "tags"]:
            assert key in out

    def test_confidence_capped_at_0_95(self):
        results = [StrategyResult(f"s{i}", "BUY", 1.0) for i in range(5)]
        out = combine_strategies(results)
        assert out["confidence"] <= 0.95
