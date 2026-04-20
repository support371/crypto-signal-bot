/**
 * src/components/PriceChart.tsx
 *
 * PHASE 3 — Real OHLCV chart from backend.
 *
 * REMOVED (phase 3):
 *   - The useMemo(() => { for loop with Math.random() }) block  (finding F2)
 *     This was generating fake 24h price history every render.
 *
 * REPLACED WITH:
 *   - GET /price/ohlcv?symbol=BTCUSDT&interval=1h&limit=24
 *   - Explicit "Market data unavailable" state while endpoint is offline
 *     or not yet deployed (Phase 2 new route).
 *
 * RULE 5: No fabricated runtime values.
 * The chart renders real candles or an explicit unavailable state.
 * It never renders random data as if it were market truth.
 */

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { apiFetch, BackendUnavailableError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { CoinPrice } from "@/hooks/usePrices";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OhlcvCandle {
  time: number;   // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface OhlcvResponse {
  symbol: string;
  interval: string;
  candles: OhlcvCandle[];
}

// Chart-display shape (time as label string for Recharts XAxis)
interface ChartPoint {
  time: string;
  price: number;
}

// ---------------------------------------------------------------------------
// Fetch OHLCV from backend
// ---------------------------------------------------------------------------

async function fetchOhlcv(backendSymbol: string): Promise<ChartPoint[]> {
  const data = await apiFetch<OhlcvResponse>(
    `/price/ohlcv?symbol=${encodeURIComponent(backendSymbol)}&interval=1h&limit=24`
  );
  return data.candles.map((c) => ({
    time:  new Date(c.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    price: c.close,
  }));
}

// ---------------------------------------------------------------------------
// Unavailable placeholder — shown when backend OHLCV route is not yet live
// or when the backend is unreachable.
// IMPORTANT: This renders "unavailable", not random data.
// ---------------------------------------------------------------------------

function ChartUnavailable({ reason }: { reason: string }) {
  return (
    <div className="cyber-card p-6 h-[300px] flex flex-col items-center justify-center gap-3">
      <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
      <p className="text-sm font-mono text-muted-foreground text-center max-w-xs">
        {reason}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PriceChart component
// ---------------------------------------------------------------------------

interface PriceChartProps {
  price: CoinPrice | null;
  isLoading: boolean;
}

export function PriceChart({ price, isLoading }: PriceChartProps) {
  const [chartData,    setChartData]    = useState<ChartPoint[] | null>(null);
  const [chartError,   setChartError]   = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  // Fetch real OHLCV whenever the selected coin changes
  useEffect(() => {
    if (!price) {
      setChartData(null);
      setChartError(null);
      return;
    }

    const backendSymbol = `${price.symbol.toUpperCase()}USDT`;
    let cancelled = false;

    (async () => {
      setChartLoading(true);
      setChartError(null);
      try {
        const data = await fetchOhlcv(backendSymbol);
        if (!cancelled) setChartData(data);
      } catch (err) {
        if (cancelled) return;
        if (
          err instanceof BackendUnavailableError &&
          err.status === 404
        ) {
          // OHLCV endpoint not yet deployed — explicit unavailable, not random data
          setChartError(
            "Historical chart data requires GET /price/ohlcv on the backend. " +
            "Deploy the route (Phase 3 gap) to enable this view."
          );
        } else {
          setChartError("Chart data unavailable — backend unreachable.");
        }
        setChartData(null);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [price?.symbol]);

  // Loading skeleton
  if (isLoading || chartLoading) {
    return (
      <div className="cyber-card p-6 h-[300px] animate-pulse">
        <div className="h-full bg-muted rounded" />
      </div>
    );
  }

  // No coin selected
  if (!price) {
    return (
      <div className="cyber-card p-6 h-[300px] flex items-center justify-center">
        <span className="text-muted-foreground font-mono text-sm">
          Select a coin to view chart
        </span>
      </div>
    );
  }

  // OHLCV unavailable — explicit state, never synthetic data
  if (chartError || !chartData) {
    return (
      <ChartUnavailable
        reason={chartError ?? "Awaiting market data from backend."}
      />
    );
  }

  // Real data
  const bullish = price.change24h >= 0;
  const strokeColor = bullish ? "hsl(145, 100%, 50%)" : "hsl(0, 85%, 55%)";
  const fillId      = bullish ? "greenGradient"        : "redGradient";

  return (
    <div className="cyber-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">
            {price.symbol}
            <span className="text-muted-foreground font-normal text-lg ml-2">
              / USD
            </span>
          </h2>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="font-mono text-3xl font-bold">
              ${price.price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: price.price < 1 ? 6 : 2,
              })}
            </span>
            <span
              className={cn(
                "text-lg font-semibold",
                bullish ? "status-bullish" : "status-bearish"
              )}
            >
              {bullish ? "+" : ""}
              {price.change24h.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>Vol 24h</div>
          <div className="font-mono">
            ${(price.volume24h / 1e9).toFixed(2)}B
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-[200px] chart-glow">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="greenGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(145, 100%, 50%)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="redGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(0, 85%, 55%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(0, 85%, 55%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              stroke="hsl(180, 40%, 30%)"
              tick={{ fill: "hsl(180, 40%, 60%)", fontSize: 10 }}
              axisLine={{ stroke: "hsl(230, 30%, 18%)" }}
            />
            <YAxis
              domain={["auto", "auto"]}
              stroke="hsl(180, 40%, 30%)"
              tick={{ fill: "hsl(180, 40%, 60%)", fontSize: 10 }}
              axisLine={{ stroke: "hsl(230, 30%, 18%)" }}
              tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
              width={80}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(230, 30%, 10%)",
                border: "1px solid hsl(180, 100%, 50%)",
                borderRadius: "8px",
              }}
              formatter={(v) => [`$${Number(v).toLocaleString()}`, "Price"]}
            />
            <Area
              type="monotone"
              dataKey="price"
              stroke={strokeColor}
              strokeWidth={2}
              fill={`url(#${fillId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
