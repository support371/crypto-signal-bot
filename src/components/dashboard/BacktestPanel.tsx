// src/components/dashboard/BacktestPanel.tsx
/**
 * BacktestPanel — Signal Quality Audit
 *
 * Fetches live OHLCV from the backend, runs all 3 strategies,
 * and displays side-by-side performance metrics with equity curves.
 */
import { useState, useCallback } from "react";
import {
  BarChart2, TrendingUp, TrendingDown, Activity,
  RefreshCw, ChevronDown, ChevronUp, Trophy, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface StrategyResult {
  strategy_id: string;
  symbol: string;
  candle_count: number;
  trade_count: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  total_return_pct: number;
  sharpe_ratio: number;
  sortino_ratio: number;
  max_drawdown_pct: number;
  profit_factor: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  starting_equity: number;
  ending_equity: number;
  candle_interval: string;
  equity_curve: { ts: number; equity: number }[];
  trades: {
    entry_ts: number;
    exit_ts: number;
    pnl: number;
    pnl_pct: number;
    exit_reason: string;
    confidence: number;
  }[];
}

interface ComparisonResult {
  symbol: string;
  candle_count: number;
  candle_interval: string;
  best_strategy: string;
  elapsed_ms: number;
  results: StrategyResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const API = import.meta.env.VITE_API_URL ?? "";
const fmt = (n: number, dp = 2) => n.toFixed(dp);
const pct = (n: number) => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STRATEGY_LABELS: Record<string, string> = {
  trend_v1: "EMA Trend",
  mean_reversion_v1: "Mean Reversion",
  momentum_v1: "MACD Momentum",
};

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const INTERVALS = [
  { value: "1h", label: "1h (hourly)" },
  { value: "4h", label: "4h" },
  { value: "1d", label: "1d (daily)" },
];
const LIMITS: Record<string, number> = { "1h": 500, "4h": 365, "1d": 365 };

// ---------------------------------------------------------------------------
// Mini equity sparkline (pure SVG, no external charting lib)
// ---------------------------------------------------------------------------
function Sparkline({ points, positive }: { points: { ts: number; equity: number }[]; positive: boolean }) {
  if (points.length < 2) return <div className="h-12 flex items-center text-xs text-slate-500">No trades</div>;
  const vals = points.map(p => p.equity);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 180; const H = 48;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = vals.map(v => H - ((v - min) / range) * H);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const color = positive ? "#22c55e" : "#ef4444";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <polyline points={xs.map((x, i) => `${x},${ys[i]}`).join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="3" fill={color} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Strategy card
// ---------------------------------------------------------------------------
function StrategyCard({
  result, isBest,
}: { result: StrategyResult; isBest: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const positive = result.total_return_pct >= 0;
  const returnColor = positive ? "text-green-400" : "text-red-400";
  const sharpeColor = result.sharpe_ratio >= 1 ? "text-green-400" : result.sharpe_ratio >= 0 ? "text-yellow-400" : "text-red-400";

  const exitReasons = result.trades.reduce<Record<string, number>>((acc, t) => {
    acc[t.exit_reason] = (acc[t.exit_reason] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className={`rounded-xl border p-4 space-y-3 transition-all ${isBest ? "border-yellow-500 bg-yellow-500/5" : "border-slate-700 bg-slate-800/50"}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isBest && <Trophy size={14} className="text-yellow-400" />}
          <span className="font-semibold text-sm text-white">{STRATEGY_LABELS[result.strategy_id] ?? result.strategy_id}</span>
        </div>
        <Badge variant="outline" className={`text-xs ${returnColor} border-current`}>
          {pct(result.total_return_pct)}
        </Badge>
      </div>

      {/* Sparkline */}
      <Sparkline points={result.equity_curve} positive={positive} />

      {/* Core metrics grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-slate-900/60 rounded p-2">
          <div className="text-slate-400">Win Rate</div>
          <div className={`font-bold text-sm ${result.win_rate >= 0.5 ? "text-green-400" : "text-red-400"}`}>
            {fmt(result.win_rate * 100, 1)}%
          </div>
          <div className="text-slate-500">{result.win_count}W / {result.loss_count}L</div>
        </div>
        <div className="bg-slate-900/60 rounded p-2">
          <div className="text-slate-400">Sharpe</div>
          <div className={`font-bold text-sm ${sharpeColor}`}>{fmt(result.sharpe_ratio)}</div>
          <div className="text-slate-500">Sortino {fmt(Math.min(result.sortino_ratio, 99))}</div>
        </div>
        <div className="bg-slate-900/60 rounded p-2">
          <div className="text-slate-400">Max Drawdown</div>
          <div className={`font-bold text-sm ${result.max_drawdown_pct > 20 ? "text-red-400" : result.max_drawdown_pct > 10 ? "text-yellow-400" : "text-green-400"}`}>
            -{fmt(result.max_drawdown_pct)}%
          </div>
        </div>
        <div className="bg-slate-900/60 rounded p-2">
          <div className="text-slate-400">Profit Factor</div>
          <div className={`font-bold text-sm ${result.profit_factor >= 1.5 ? "text-green-400" : result.profit_factor >= 1 ? "text-yellow-400" : "text-red-400"}`}>
            {result.profit_factor >= 999 ? "∞" : fmt(result.profit_factor)}
          </div>
        </div>
      </div>

      {/* Equity summary */}
      <div className="flex justify-between text-xs text-slate-400 border-t border-slate-700 pt-2">
        <span>Start {usd(result.starting_equity)}</span>
        <span className={positive ? "text-green-400" : "text-red-400"}>End {usd(result.ending_equity)}</span>
      </div>

      {/* Expand button */}
      <button
        className="w-full text-xs text-slate-400 hover:text-white flex items-center justify-center gap-1 pt-1"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <><ChevronUp size={12} /> Hide details</> : <><ChevronDown size={12} /> Trade details</>}
      </button>

      {expanded && (
        <div className="space-y-2 text-xs border-t border-slate-700 pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div><span className="text-slate-400">Trades: </span><span>{result.trade_count}</span></div>
            <div><span className="text-slate-400">Candles: </span><span>{result.candle_count}</span></div>
            <div><span className="text-slate-400">Avg Win: </span><span className="text-green-400">{pct(result.avg_win_pct)}</span></div>
            <div><span className="text-slate-400">Avg Loss: </span><span className="text-red-400">{pct(result.avg_loss_pct)}</span></div>
            <div><span className="text-slate-400">Best: </span><span className="text-green-400">{pct(result.best_trade_pct)}</span></div>
            <div><span className="text-slate-400">Worst: </span><span className="text-red-400">{pct(result.worst_trade_pct)}</span></div>
          </div>
          {Object.entries(exitReasons).length > 0 && (
            <div className="pt-1">
              <div className="text-slate-400 mb-1">Exit reasons:</div>
              {Object.entries(exitReasons).map(([reason, count]) => (
                <div key={reason} className="flex justify-between">
                  <span className="text-slate-300">{reason.replace(/_/g, " ")}</span>
                  <span>{count}</span>
                </div>
              ))}
            </div>
          )}
          {/* Last 5 trades */}
          {result.trades.length > 0 && (
            <div className="pt-1">
              <div className="text-slate-400 mb-1">Last {Math.min(5, result.trades.length)} trades:</div>
              <div className="space-y-1">
                {result.trades.slice(-5).reverse().map((t, i) => (
                  <div key={i} className={`flex justify-between rounded px-2 py-1 ${t.pnl >= 0 ? "bg-green-900/20" : "bg-red-900/20"}`}>
                    <span>{new Date(t.exit_ts * 1000).toLocaleDateString()}</span>
                    <span className={t.pnl >= 0 ? "text-green-400" : "text-red-400"}>{pct(t.pnl_pct)}</span>
                    <span className="text-slate-500">{t.exit_reason.replace(/_/g, " ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export function BacktestPanel() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);

  const runBacktest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${API}/api/v1/backtest/live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          candle_interval: interval,
          limit: LIMITS[interval] ?? 365,
          strategy_id: null, // compare all
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(err.detail ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message ?? "Backtest failed");
    } finally {
      setLoading(false);
    }
  }, [symbol, interval]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={symbol} onValueChange={setSymbol}>
          <SelectTrigger className="w-36 bg-slate-800 border-slate-600 text-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            {SYMBOLS.map(s => (
              <SelectItem key={s} value={s} className="text-white hover:bg-slate-700">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={interval} onValueChange={setInterval}>
          <SelectTrigger className="w-40 bg-slate-800 border-slate-600 text-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-600">
            {INTERVALS.map(iv => (
              <SelectItem key={iv.value} value={iv.value} className="text-white hover:bg-slate-700">{iv.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          onClick={runBacktest}
          disabled={loading}
          size="sm"
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {loading
            ? <><RefreshCw size={14} className="animate-spin mr-1" />Running…</>
            : <><BarChart2 size={14} className="mr-1" />Run Backtest</>}
        </Button>

        {result && (
          <span className="text-xs text-slate-400">
            {result.candle_count} candles · {result.elapsed_ms.toFixed(0)}ms
          </span>
        )}
      </div>

      {/* Info banner */}
      {!result && !loading && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-sm text-slate-400 space-y-1">
          <div className="flex items-center gap-2 text-white font-medium">
            <Activity size={14} />Signal Quality Audit
          </div>
          <p>Runs all 3 strategies against live historical data. Simulates paper trades with 2% risk sizing, 0.1% commission, and ATR-based stops. No look-ahead bias.</p>
          <p className="text-xs">Metrics: Win Rate · Sharpe · Sortino · Max Drawdown · Profit Factor · Equity Curve</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-900/20 p-3 text-sm text-red-400">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl border border-slate-700 bg-slate-800/50 p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-slate-700 rounded w-1/2" />
              <div className="h-12 bg-slate-700 rounded" />
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map(j => <div key={j} className="h-12 bg-slate-700 rounded" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <Trophy size={14} className="text-yellow-400" />
            <span className="text-slate-300">Best strategy on {result.symbol} ({result.candle_interval}):</span>
            <span className="font-semibold text-yellow-400">{STRATEGY_LABELS[result.best_strategy] ?? result.best_strategy}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {result.results.map(r => (
              <StrategyCard
                key={r.strategy_id}
                result={r}
                isBest={r.strategy_id === result.best_strategy}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default BacktestPanel;
