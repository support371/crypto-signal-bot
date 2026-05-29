"""Tests for the earnings ledger (FIFO lot matching and P&L calculation).

Covers:
  - BUY opens a lot
  - SELL closes lots FIFO, computing realized P&L
  - Partial fills split a lot
  - Short-sell with no open lot
  - Multiple symbols are tracked independently
  - Summary statistics (win rate, best/worst, avg)
  - History filtering and ordering
  - Reset clears all data
"""

from __future__ import annotations

import os
import tempfile
from typing import Dict, List

import pytest

import backend.logic.earnings as earnings_mod


@pytest.fixture(autouse=True)
def isolated_store(tmp_path):
    """Point the earnings store at a temp file and reset state each test."""
    store = str(tmp_path / "earnings.json")
    os.environ["EARNINGS_STORE_PATH"] = store
    # Force reload from the new path
    earnings_mod._loaded_store_path = None
    earnings_mod._open_lots = {}
    earnings_mod._closed_trades = []
    yield
    os.environ.pop("EARNINGS_STORE_PATH", None)


# ---------------------------------------------------------------------------
# Basic BUY / SELL flow
# ---------------------------------------------------------------------------

class TestBasicFlow:
    def test_buy_opens_lot(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="buy-1",
        )
        summary = earnings_mod.get_summary()
        assert summary["open_lots"] == 1
        assert summary["trade_count"] == 0

    def test_sell_closes_lot_and_realizes_pnl(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="buy-1",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="SELL", quantity=1.0,
            fill_price=42000.0, intent_id="sell-1",
        )
        summary = earnings_mod.get_summary()
        assert summary["trade_count"] == 1
        assert summary["total_realized_pnl"] == pytest.approx(2000.0, abs=0.01)
        assert summary["open_lots"] == 0
        assert summary["win_count"] == 1

    def test_sell_with_loss(self) -> None:
        earnings_mod.record_fill(
            symbol="ETHUSDT", side="BUY", quantity=10.0,
            fill_price=2600.0, intent_id="buy-eth",
        )
        earnings_mod.record_fill(
            symbol="ETHUSDT", side="SELL", quantity=10.0,
            fill_price=2500.0, intent_id="sell-eth",
        )
        summary = earnings_mod.get_summary()
        assert summary["total_realized_pnl"] == pytest.approx(-1000.0, abs=0.01)
        assert summary["loss_count"] == 1


# ---------------------------------------------------------------------------
# FIFO lot matching
# ---------------------------------------------------------------------------

class TestFIFO:
    def test_fifo_order(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="b1",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=41000.0, intent_id="b2",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="SELL", quantity=1.0,
            fill_price=42000.0, intent_id="s1",
        )
        history = earnings_mod.get_history(symbol="BTCUSDT")
        assert len(history) == 1
        assert history[0]["entry_price"] == 40000.0
        assert history[0]["realized_pnl"] == pytest.approx(2000.0, abs=0.01)

        summary = earnings_mod.get_summary()
        assert summary["open_lots"] == 1


# ---------------------------------------------------------------------------
# Partial fills
# ---------------------------------------------------------------------------

class TestPartialFills:
    def test_partial_sell_splits_lot(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=2.0,
            fill_price=40000.0, intent_id="b1",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="SELL", quantity=0.5,
            fill_price=42000.0, intent_id="s1",
        )
        summary = earnings_mod.get_summary()
        assert summary["trade_count"] == 1
        assert summary["total_realized_pnl"] == pytest.approx(1000.0, abs=0.01)
        assert summary["open_lots"] == 1

    def test_sell_spans_multiple_lots(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="b1",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=41000.0, intent_id="b2",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="SELL", quantity=1.5,
            fill_price=42000.0, intent_id="s1",
        )
        summary = earnings_mod.get_summary()
        assert summary["trade_count"] == 2
        # lot 1: (42000-40000)*1.0 = 2000
        # lot 2: (42000-41000)*0.5 = 500
        assert summary["total_realized_pnl"] == pytest.approx(2500.0, abs=0.01)
        assert summary["open_lots"] == 1


# ---------------------------------------------------------------------------
# Short sell (no open lots)
# ---------------------------------------------------------------------------

class TestShortSell:
    def test_sell_without_open_lots(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="SELL", quantity=1.0,
            fill_price=42000.0, intent_id="naked-sell",
        )
        history = earnings_mod.get_history()
        assert len(history) == 1
        assert history[0]["entry_price"] is None
        assert history[0]["note"] == "no_open_lot"
        # Not counted in P&L summary (entry_price is None)
        summary = earnings_mod.get_summary()
        assert summary["trade_count"] == 0


# ---------------------------------------------------------------------------
# Multiple symbols
# ---------------------------------------------------------------------------

class TestMultipleSymbols:
    def test_symbols_tracked_independently(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="b-btc",
        )
        earnings_mod.record_fill(
            symbol="ETHUSDT", side="BUY", quantity=10.0,
            fill_price=2600.0, intent_id="b-eth",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="SELL", quantity=1.0,
            fill_price=41000.0, intent_id="s-btc",
        )
        btc_history = earnings_mod.get_history(symbol="BTCUSDT")
        eth_history = earnings_mod.get_history(symbol="ETHUSDT")
        assert len(btc_history) == 1
        assert len(eth_history) == 0
        summary = earnings_mod.get_summary()
        assert summary["open_lots"] == 1  # ETH lot still open


# ---------------------------------------------------------------------------
# Summary statistics
# ---------------------------------------------------------------------------

class TestSummary:
    def test_win_rate(self) -> None:
        for i, exit_price in enumerate([42000.0, 39000.0, 43000.0]):
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="BUY", quantity=1.0,
                fill_price=40000.0, intent_id=f"b{i}",
            )
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="SELL", quantity=1.0,
                fill_price=exit_price, intent_id=f"s{i}",
            )
        summary = earnings_mod.get_summary()
        assert summary["trade_count"] == 3
        assert summary["win_count"] == 2
        assert summary["loss_count"] == 1
        assert summary["win_rate_pct"] == pytest.approx(66.67, abs=0.1)

    def test_best_and_worst(self) -> None:
        for i, exit_price in enumerate([42000.0, 38000.0]):
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="BUY", quantity=1.0,
                fill_price=40000.0, intent_id=f"b{i}",
            )
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="SELL", quantity=1.0,
                fill_price=exit_price, intent_id=f"s{i}",
            )
        summary = earnings_mod.get_summary()
        assert summary["best_trade_pnl"] == pytest.approx(2000.0, abs=0.01)
        assert summary["worst_trade_pnl"] == pytest.approx(-2000.0, abs=0.01)

    def test_empty_summary(self) -> None:
        summary = earnings_mod.get_summary()
        assert summary["trade_count"] == 0
        assert summary["total_realized_pnl"] == 0.0
        assert summary["win_rate_pct"] == 0.0
        assert summary["open_lots"] == 0


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

class TestHistory:
    def test_history_limit(self) -> None:
        for i in range(5):
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="BUY", quantity=1.0,
                fill_price=40000.0, intent_id=f"b{i}",
            )
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="SELL", quantity=1.0,
                fill_price=41000.0, intent_id=f"s{i}",
            )
        history = earnings_mod.get_history(limit=3)
        assert len(history) == 3

    def test_history_ordered_newest_first(self) -> None:
        for i in range(3):
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="BUY", quantity=1.0,
                fill_price=40000.0, intent_id=f"b{i}",
                timestamp=float(1000 + i),
            )
            earnings_mod.record_fill(
                symbol="BTCUSDT", side="SELL", quantity=1.0,
                fill_price=41000.0, intent_id=f"s{i}",
                timestamp=float(2000 + i),
            )
        history = earnings_mod.get_history()
        timestamps = [t["closed_at"] for t in history]
        assert timestamps == sorted(timestamps, reverse=True)

    def test_history_filter_by_symbol(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="b-btc",
        )
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="SELL", quantity=1.0,
            fill_price=41000.0, intent_id="s-btc",
        )
        earnings_mod.record_fill(
            symbol="ETHUSDT", side="BUY", quantity=10.0,
            fill_price=2600.0, intent_id="b-eth",
        )
        earnings_mod.record_fill(
            symbol="ETHUSDT", side="SELL", quantity=10.0,
            fill_price=2700.0, intent_id="s-eth",
        )
        assert len(earnings_mod.get_history(symbol="BTCUSDT")) == 1
        assert len(earnings_mod.get_history(symbol="ETHUSDT")) == 1
        assert len(earnings_mod.get_history()) == 2


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

class TestReset:
    def test_reset_clears_everything(self) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="b1",
        )
        earnings_mod.reset_earnings()
        summary = earnings_mod.get_summary()
        assert summary["trade_count"] == 0
        assert summary["open_lots"] == 0


# ---------------------------------------------------------------------------
# Persistence round-trip
# ---------------------------------------------------------------------------

class TestPersistence:
    def test_save_and_reload(self, tmp_path) -> None:
        earnings_mod.record_fill(
            symbol="BTCUSDT", side="BUY", quantity=1.0,
            fill_price=40000.0, intent_id="b1",
        )
        # Force a reload from disk
        earnings_mod._loaded_store_path = None
        earnings_mod._open_lots = {}
        earnings_mod._closed_trades = []
        summary = earnings_mod.get_summary()
        assert summary["open_lots"] == 1
