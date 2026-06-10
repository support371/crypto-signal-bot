# backend/backtest/engine.py
"""
Walk-forward backtesting engine.

Given a sequence of OHLCV candles, simulates trading based on the signal
strategies and computes rigorous performance metrics:

  - Total return (%)
  - Win rate (%)
  - Sharpe ratio (annualized, assumes ~daily candles unless interval given)
  - Sortino ratio
  - Max drawdown (%)
  - Profit factor (gross profit / gross loss)
  - Avg win / avg loss
  - Equity curve (time series of portfolio value)
  - Per-trade log

Paper-money simulation rules:
  - Starting capital: $10,000 USDT
  - Position sizing: risk 2% of equity per trade (ATR-based stop)
  - Long-only (paper venue constraint)
  - No leverage
  - Commission: 0.1% per trade (taker fee approximation)
  - Slippage: 0.05% per trade
  - Entry: next candle open after signal fires (avoid look-ahead bias)
  - Exit: when opposing signal fires OR stop-loss / take-profit hit
  - Stop-loss: 2× ATR below entry
  - Take-profit: 3× ATR above entry (risk:reward 1:1.5)

Determinism: same candle input → identical result every run.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from backend.replay.replayer import (
    ReplayCandle,
    _classify,
)
from backend.logic.indicators import (
    atr as compute_atr_series,
    bollinger_bands as compute_bb_series,
    ema as compute_ema_series,
    macd as compute_macd_series,
    rsi as compute_rsi_series,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STARTING_CAPITAL = 10_000.0      # USDT
RISK_PER_TRADE_PCT = 0.02        # 2% equity risk per trade
COMMISSION_PCT = 0.001           # 0.1% taker fee
SLIPPAGE_PCT = 0.0005            # 0.05% slippage
ATR_STOP_MULT = 2.0              # stop = entry - 2*ATR
ATR_TP_MULT = 3.0                # take-profit = entry + 3*ATR
MIN_CANDLES = 26                 # MACD warmup
CONFIDENCE_THRESHOLD = 0.55      # minimum signal confidence to enter a trade
ANNUALIZATION_FACTOR = 365       # assume daily candles by default

STRATEGIES = ["trend_v1", "mean_reversion_v1", "momentum_v1"]


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class BacktestTrade:
    entry_ts: float
    exit_ts: float
    side: str               # "BUY"
    entry_price: float
    exit_price: float
    quantity: float
    pnl: float              # realized P&L in USDT after commission+slippage
    pnl_pct: float          # % return on that trade
    exit_reason: str        # "signal_exit" | "stop_loss" | "take_profit" | "end_of_data"
    strategy_id: str
    confidence: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_ts": self.entry_ts,
            "exit_ts": self.exit_ts,
            "side": self.side,
            "entry_price": round(self.entry_price, 4),
            "exit_price": round(self.exit_price, 4),
            "quantity": round(self.quantity, 6),
            "pnl": round(self.pnl, 4),
            "pnl_pct": round(self.pnl_pct, 4),
            "exit_reason": self.exit_reason,
            "strategy_id": self.strategy_id,
            "confidence": round(self.confidence, 4),
        }


@dataclass
class EquityPoint:
    ts: float
    equity: float

    def to_dict(self) -> Dict[str, Any]:
        return {"ts": self.ts, "equity": round(self.equity, 2)}


@dataclass
class BacktestMetrics:
    strategy_id: str
    symbol: str
    candle_count: int
    trade_count: int
    win_count: int
    loss_count: int
    win_rate: float          # 0.0–1.0
    total_return_pct: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown_pct: float
    profit_factor: float     # gross_profit / gross_loss (inf if no losses)
    avg_win_pct: float
    avg_loss_pct: float
    best_trade_pct: float
    worst_trade_pct: float
    starting_equity: float
    ending_equity: float
    equity_curve: List[EquityPoint]
    trades: List[BacktestTrade]
    elapsed_ms: float
    result_hash: str         # determinism proof
    candle_interval: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "strategy_id": self.strategy_id,
            "symbol": self.symbol,
            "candle_count": self.candle_count,
            "trade_count": self.trade_count,
            "win_count": self.win_count,
            "loss_count": self.loss_count,
            "win_rate": round(self.win_rate, 4),
            "total_return_pct": round(self.total_return_pct, 4),
            "sharpe_ratio": round(self.sharpe_ratio, 4),
            "sortino_ratio": round(self.sortino_ratio, 4),
            "max_drawdown_pct": round(self.max_drawdown_pct, 4),
            "profit_factor": round(self.profit_factor, 4) if math.isfinite(self.profit_factor) else 999.0,
            "avg_win_pct": round(self.avg_win_pct, 4),
            "avg_loss_pct": round(self.avg_loss_pct, 4),
            "best_trade_pct": round(self.best_trade_pct, 4),
            "worst_trade_pct": round(self.worst_trade_pct, 4),
            "starting_equity": round(self.starting_equity, 2),
            "ending_equity": round(self.ending_equity, 2),
            "equity_curve": [p.to_dict() for p in self.equity_curve],
            "trades": [t.to_dict() for t in self.trades],
            "elapsed_ms": round(self.elapsed_ms, 2),
            "result_hash": self.result_hash,
            "candle_interval": self.candle_interval,
        }


@dataclass
class BacktestComparison:
    """Side-by-side comparison of all three strategies on the same candle set."""
    symbol: str
    candle_count: int
    candle_interval: str
    results: List[BacktestMetrics]
    best_strategy: str       # by Sharpe ratio
    elapsed_ms: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "symbol": self.symbol,
            "candle_count": self.candle_count,
            "candle_interval": self.candle_interval,
            "best_strategy": self.best_strategy,
            "elapsed_ms": round(self.elapsed_ms, 2),
            "results": [r.to_dict() for r in self.results],
        }


# ---------------------------------------------------------------------------
# Core simulation
# ---------------------------------------------------------------------------

def _apply_cost(price: float, is_buy: bool) -> float:
    """Apply slippage + commission to the execution price."""
    slip = price * SLIPPAGE_PCT
    comm = price * COMMISSION_PCT
    if is_buy:
        return price + slip + comm
    return price - slip - comm


def _position_size(equity: float, entry_price: float, stop_price: float) -> float:
    """Risk-based position sizing: risk 2% of equity per trade."""
    risk_usd = equity * RISK_PER_TRADE_PCT
    risk_per_unit = abs(entry_price - stop_price)
    if risk_per_unit <= 0:
        return 0.0
    return risk_usd / risk_per_unit


def _compute_sharpe(returns: List[float], annualization: int = ANNUALIZATION_FACTOR) -> float:
    if len(returns) < 2:
        return 0.0
    n = len(returns)
    mean = sum(returns) / n
    variance = sum((r - mean) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(variance)
    if std == 0:
        return 0.0
    return (mean / std) * math.sqrt(annualization)


def _compute_sortino(returns: List[float], annualization: int = ANNUALIZATION_FACTOR) -> float:
    if len(returns) < 2:
        return 0.0
    mean = sum(returns) / len(returns)
    downside = [r for r in returns if r < 0]
    if not downside:
        return float("inf") if mean > 0 else 0.0
    downside_var = sum(r ** 2 for r in downside) / len(downside)
    downside_std = math.sqrt(downside_var)
    if downside_std == 0:
        return 0.0
    return (mean / downside_std) * math.sqrt(annualization)


def _max_drawdown(equity_curve: List[float]) -> float:
    """Return max drawdown as a positive percentage (e.g. 12.5 means 12.5% drawdown)."""
    if not equity_curve:
        return 0.0
    peak = equity_curve[0]
    max_dd = 0.0
    for val in equity_curve:
        if val > peak:
            peak = val
        dd = (peak - val) / peak * 100
        if dd > max_dd:
            max_dd = dd
    return max_dd


def _hash_result(trades: List[BacktestTrade], ending_equity: float) -> str:
    data = json.dumps(
        {
            "trades": [
                {"entry": t.entry_ts, "exit": t.exit_ts, "pnl": round(t.pnl, 4)}
                for t in trades
            ],
            "ending_equity": round(ending_equity, 2),
        },
        sort_keys=True,
    )
    return hashlib.sha256(data.encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Backtest runner
# ---------------------------------------------------------------------------

class BacktestEngine:
    """
    Walk-forward backtester.

    Iterates through candles one by one, building the indicator window
    progressively to avoid look-ahead bias. Enters a trade on the OPEN
    of the candle AFTER a signal fires.
    """

    def run(
        self,
        symbol: str,
        candles: List[ReplayCandle],
        strategy_id: str = "trend_v1",
        candle_interval: str = "1d",
    ) -> BacktestMetrics:
        t0 = time.perf_counter()

        equity = STARTING_CAPITAL
        equity_curve_vals: List[float] = [equity]
        equity_points: List[EquityPoint] = []
        trades: List[BacktestTrade] = []
        trade_returns: List[float] = []

        in_position = False
        entry_price = 0.0
        stop_price = 0.0
        tp_price = 0.0
        qty = 0.0
        entry_ts = 0.0
        entry_confidence = 0.0

        # Pre-compute indicators for the entire series to avoid O(N^2)
        closes = [float(c.close) for c in candles]
        highs = [float(c.high) for c in candles]
        lows = [float(c.low) for c in candles]

        rsi_s = compute_rsi_series(closes, 14)
        ema20_s = compute_ema_series(closes, 20)
        ema50_s = compute_ema_series(closes, 50)
        ema200_s = compute_ema_series(closes, 200)
        macd_l_s, macd_sig_s, macd_hist_s = compute_macd_series(closes, 12, 26, 9)
        bb_u_s, bb_m_s, bb_l_s = compute_bb_series(closes, 20, 2.0)
        atr_s = compute_atr_series(highs, lows, closes, 14)

        for i in range(MIN_CANDLES, len(candles)):
            # window = candles[:i] -> indicators for candle at i-1
            # BacktestEngine uses window = candles[:i] and then accesses indicators for the LAST candle in that window (i-1)
            # to make decisions for trade at candle i.
            idx = i - 1
            indicators = {
                "rsi": rsi_s[idx],
                "ema20": ema20_s[idx],
                "ema50": ema50_s[idx],
                "ema200": ema200_s[idx],
                "macd_line": macd_l_s[idx],
                "macd_signal": macd_sig_s[idx],
                "macd_hist": macd_hist_s[idx],
                "bb_upper": bb_u_s[idx],
                "bb_mid": bb_m_s[idx],
                "bb_lower": bb_l_s[idx],
                "atr": atr_s[idx],
            }

            candle = candles[i]            # current candle (no look-ahead)
            atr = indicators.get("atr") or 0.0
            current_close = float(candles[idx].close)
            side, confidence = _classify(strategy_id, indicators, current_close)

            # --- Manage open position ---
            if in_position:
                # Check stop-loss / take-profit on this candle's OHLC
                hit_sl = candle.low <= stop_price
                hit_tp = candle.high >= tp_price

                exit_reason = None
                exit_price_raw = candle.open  # default: exit at open

                if hit_sl and hit_tp:
                    # Both hit — assume SL first (conservative)
                    exit_reason = "stop_loss"
                    exit_price_raw = stop_price
                elif hit_sl:
                    exit_reason = "stop_loss"
                    exit_price_raw = stop_price
                elif hit_tp:
                    exit_reason = "take_profit"
                    exit_price_raw = tp_price
                elif side == "SELL" and confidence >= CONFIDENCE_THRESHOLD:
                    exit_reason = "signal_exit"
                    exit_price_raw = candle.open

                if exit_reason:
                    exit_px = _apply_cost(exit_price_raw, is_buy=False)
                    pnl = (exit_px - entry_price) * qty
                    pnl_pct = (exit_px - entry_price) / entry_price * 100
                    equity += pnl
                    trade = BacktestTrade(
                        entry_ts=entry_ts,
                        exit_ts=candle.timestamp,
                        side="BUY",
                        entry_price=entry_price,
                        exit_price=exit_px,
                        quantity=qty,
                        pnl=pnl,
                        pnl_pct=pnl_pct,
                        exit_reason=exit_reason,
                        strategy_id=strategy_id,
                        confidence=entry_confidence,
                    )
                    trades.append(trade)
                    trade_returns.append(pnl_pct / 100)
                    equity_curve_vals.append(equity)
                    equity_points.append(EquityPoint(ts=candle.timestamp, equity=equity))
                    in_position = False

            # --- Enter new position ---
            if not in_position and side == "BUY" and confidence >= CONFIDENCE_THRESHOLD and equity > 0:
                raw_entry = candle.open
                entry_px = _apply_cost(raw_entry, is_buy=True)
                atr_stop = atr if atr > 0 else raw_entry * 0.02
                sl = entry_px - ATR_STOP_MULT * atr_stop
                tp = entry_px + ATR_TP_MULT * atr_stop
                position_qty = _position_size(equity, entry_px, sl)
                if position_qty > 0 and position_qty * entry_px <= equity:
                    in_position = True
                    entry_price = entry_px
                    stop_price = sl
                    tp_price = tp
                    qty = position_qty
                    entry_ts = candle.timestamp
                    entry_confidence = confidence

        # Close any open position at last candle close
        if in_position and candles:
            last = candles[-1]
            exit_px = _apply_cost(last.close, is_buy=False)
            pnl = (exit_px - entry_price) * qty
            pnl_pct = (exit_px - entry_price) / entry_price * 100
            equity += pnl
            trades.append(BacktestTrade(
                entry_ts=entry_ts,
                exit_ts=last.timestamp,
                side="BUY",
                entry_price=entry_price,
                exit_price=exit_px,
                quantity=qty,
                pnl=pnl,
                pnl_pct=pnl_pct,
                exit_reason="end_of_data",
                strategy_id=strategy_id,
                confidence=entry_confidence,
            ))
            trade_returns.append(pnl_pct / 100)
            equity_curve_vals.append(equity)
            equity_points.append(EquityPoint(ts=last.timestamp, equity=equity))

        # --- Metrics ---
        wins = [t for t in trades if t.pnl > 0]
        losses = [t for t in trades if t.pnl <= 0]
        gross_profit = sum(t.pnl for t in wins)
        gross_loss = abs(sum(t.pnl for t in losses))

        win_rate = len(wins) / len(trades) if trades else 0.0
        total_return_pct = (equity - STARTING_CAPITAL) / STARTING_CAPITAL * 100
        sharpe = _compute_sharpe(trade_returns)
        sortino = _compute_sortino(trade_returns)
        max_dd = _max_drawdown(equity_curve_vals)
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        avg_win = sum(t.pnl_pct for t in wins) / len(wins) if wins else 0.0
        avg_loss = sum(t.pnl_pct for t in losses) / len(losses) if losses else 0.0
        best_trade = max((t.pnl_pct for t in trades), default=0.0)
        worst_trade = min((t.pnl_pct for t in trades), default=0.0)
        result_hash = _hash_result(trades, equity)

        elapsed_ms = (time.perf_counter() - t0) * 1000

        return BacktestMetrics(
            strategy_id=strategy_id,
            symbol=symbol,
            candle_count=len(candles),
            trade_count=len(trades),
            win_count=len(wins),
            loss_count=len(losses),
            win_rate=win_rate,
            total_return_pct=total_return_pct,
            sharpe_ratio=sharpe,
            sortino_ratio=sortino,
            max_drawdown_pct=max_dd,
            profit_factor=profit_factor,
            avg_win_pct=avg_win,
            avg_loss_pct=avg_loss,
            best_trade_pct=best_trade,
            worst_trade_pct=worst_trade,
            starting_equity=STARTING_CAPITAL,
            ending_equity=equity,
            equity_curve=equity_points,
            trades=trades,
            elapsed_ms=elapsed_ms,
            result_hash=result_hash,
            candle_interval=candle_interval,
        )

    def compare_all(
        self,
        symbol: str,
        candles: List[ReplayCandle],
        candle_interval: str = "1d",
    ) -> BacktestComparison:
        """Run all three strategies and return a side-by-side comparison."""
        t0 = time.perf_counter()
        results = []
        for strat in STRATEGIES:
            result = self.run(symbol=symbol, candles=candles, strategy_id=strat, candle_interval=candle_interval)
            results.append(result)

        # Best strategy = highest Sharpe; tie-break by total return
        best = max(results, key=lambda r: (r.sharpe_ratio, r.total_return_pct))
        elapsed_ms = (time.perf_counter() - t0) * 1000

        return BacktestComparison(
            symbol=symbol,
            candle_count=len(candles),
            candle_interval=candle_interval,
            results=results,
            best_strategy=best.strategy_id,
            elapsed_ms=elapsed_ms,
        )
