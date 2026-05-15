import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { CryptoPrice } from '@/types/crypto';

interface PriceChartProps {
  price: CryptoPrice | null;
  isLoading?: boolean;
}

function buildDeterministicChartData(price: CryptoPrice) {
  const points = 48;
  const basePrice = Math.max(price.price, 0);
  const changeRatio = price.change24h / 100;
  const volatility = Math.max(Math.abs(changeRatio), 0.0125);
  const seed = Array.from(price.symbol).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const phase = (seed % 360) * (Math.PI / 180);
  const data = [];

  for (let i = 0; i < points; i += 1) {
    const progress = i / Math.max(points - 1, 1);
    const timeAgo = points - i;
    const trendFactor = changeRatio * basePrice * (progress - 1);
    const cycleFactor = Math.sin(progress * Math.PI * 3 + phase) * volatility * basePrice * 0.22;
    const microCycle = Math.cos(progress * Math.PI * 9 + phase / 2) * volatility * basePrice * 0.07;
    const derivedPrice = Math.max(basePrice + trendFactor + cycleFactor + microCycle, basePrice * 0.75);

    data.push({
      time: timeAgo <= 24 ? `${timeAgo}h` : `${Math.floor(timeAgo / 24)}d`,
      price: derivedPrice,
    });
  }

  data.push({ time: 'Now', price: basePrice });
  return data;
}

export function PriceChart({ price, isLoading }: PriceChartProps) {
  const chartData = useMemo(() => {
    if (!price) return [];
    return buildDeterministicChartData(price);
  }, [price]);

  if (isLoading) {
    return (
      <div className="cyber-card p-6 h-[360px] animate-pulse">
        <div className="h-full bg-muted rounded" />
      </div>
    );
  }

  if (!price) {
    return (
      <div className="cyber-card p-6 h-[360px] flex items-center justify-center">
        <span className="text-muted-foreground">Select a coin to view chart</span>
      </div>
    );
  }

  const isPositive = price.change24h >= 0;
  const strokeColor = isPositive ? 'hsl(145, 100%, 50%)' : 'hsl(0, 85%, 55%)';
  const fillColor = isPositive ? 'url(#greenGradient)' : 'url(#redGradient)';

  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">
            {price.symbol}
            <span className="text-muted-foreground font-normal text-lg ml-2">/ USD</span>
          </h2>
          <div className="flex items-baseline gap-3 mt-1">
            <span className="font-mono text-3xl font-bold">
              ${price.price.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: price.price < 1 ? 6 : 2,
              })}
            </span>
            <span className={`text-lg font-semibold ${isPositive ? 'status-bullish' : 'status-bearish'}`}>
              {isPositive ? '+' : ''}{price.change24h.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="text-right text-sm text-muted-foreground">
          <div>Vol 24h</div>
          <div className="font-mono">${(price.volume24h / 1e9).toFixed(2)}B</div>
          <div className="mt-2 rounded border border-border/60 px-2 py-1 text-[10px] uppercase tracking-wider">
            Deterministic 48h view
          </div>
        </div>
      </div>

      <div className="h-[260px] chart-glow">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
            <XAxis dataKey="time" stroke="hsl(180, 40%, 30%)" tick={{ fill: 'hsl(180, 40%, 60%)', fontSize: 10 }} axisLine={{ stroke: 'hsl(230, 30%, 18%)' }} interval="preserveStartEnd" />
            <YAxis domain={['auto', 'auto']} stroke="hsl(180, 40%, 30%)" tick={{ fill: 'hsl(180, 40%, 60%)', fontSize: 10 }} axisLine={{ stroke: 'hsl(230, 30%, 18%)' }} tickFormatter={(value) => `$${value.toLocaleString()}`} width={80} />
            <Tooltip contentStyle={{ backgroundColor: 'hsl(230, 30%, 10%)', border: '1px solid hsl(180, 100%, 50%)', borderRadius: '8px', boxShadow: '0 0 20px hsl(180, 100%, 50%, 0.3)' }} labelStyle={{ color: 'hsl(180, 100%, 90%)' }} itemStyle={{ color: 'hsl(180, 100%, 50%)' }} formatter={(value: number) => [`$${value.toLocaleString()}`, 'Price']} />
            <Area type="monotone" dataKey="price" stroke={strokeColor} strokeWidth={2} fill={fillColor} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
