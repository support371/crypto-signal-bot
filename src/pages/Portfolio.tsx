import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';
import { usePortfolio } from '@/hooks/usePortfolio';
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  BarChart3,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface PriceData {
  price: number;
  change24h: number;
}

function numberFmt(value: number, decimals = 2): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function PnlText({ value, suffix = '' }: { value: number; suffix?: string }) {
  const color = value > 0 ? 'text-green-400' : value < 0 ? 'text-red-400' : 'text-muted-foreground';
  const prefix = value > 0 ? '+' : '';
  return <span className={`font-mono ${color}`}>{prefix}{numberFmt(value)}{suffix}</span>;
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="cyber-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="font-mono text-lg font-semibold text-foreground">{value}</div>
    </div>
  );
}

export default function Portfolio() {
  const { portfolio, isLoading, refetch } = usePortfolio(15000);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [pricesLoading, setPricesLoading] = useState(false);

  const fetchPrices = useCallback(async (symbols: string[]) => {
    if (symbols.length === 0) return;
    setPricesLoading(true);
    const results: Record<string, PriceData> = {};
    await Promise.allSettled(
      symbols.map(async (sym) => {
        try {
          const data = await fetchBackendJson<{ price: number; change24h: number }>(
            `/price?symbol=${sym}USDT`
          );
          results[sym] = { price: data.price, change24h: data.change24h ?? 0 };
        } catch {
          // skip — price unavailable for this symbol
        }
      })
    );
    setPrices((prev) => ({ ...prev, ...results }));
    setPricesLoading(false);
  }, []);

  useEffect(() => {
    if (portfolio?.positions) {
      const symbols = Object.keys(portfolio.positions).filter(
        (s) => s !== 'USDT' && portfolio.positions[s] > 0
      );
      if (symbols.length > 0) fetchPrices(symbols);
    }
  }, [portfolio?.positions, fetchPrices]);

  const cashBalance = portfolio?.balances?.USDT ?? 0;
  const openPositions = portfolio
    ? Object.entries(portfolio.positions).filter(([sym, qty]) => sym !== 'USDT' && qty > 0)
    : [];

  const totalPositionValue = openPositions.reduce((sum, [sym, qty]) => {
    const p = prices[sym];
    return sum + (p ? qty * p.price : 0);
  }, 0);

  const totalEquity = cashBalance + totalPositionValue;

  const recentOrders = portfolio
    ? [...portfolio.orders].sort((a, b) => b.created_at - a.created_at).slice(0, 20)
    : [];

  return (
    <main className="min-h-screen bg-background scanlines">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              <h1 className="font-display text-2xl font-bold tracking-wide text-foreground">
                Portfolio
              </h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Paper trading positions and order history
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="font-mono text-xs"
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Refresh
          </Button>
        </div>

        {/* Summary Stats */}
        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <StatCard
            label="Total Equity"
            icon={BarChart3}
            value={
              isLoading ? '...' : `$${numberFmt(totalEquity)}`
            }
          />
          <StatCard
            label="Cash (USDT)"
            icon={Wallet}
            value={
              isLoading ? '...' : `$${numberFmt(cashBalance)}`
            }
          />
          <StatCard
            label="Positions Value"
            icon={TrendingUp}
            value={
              isLoading || pricesLoading
                ? '...'
                : `$${numberFmt(totalPositionValue)}`
            }
          />
        </div>

        {/* Open Positions */}
        <section className="cyber-card p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
              Open Positions
            </h2>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {openPositions.length} position{openPositions.length !== 1 ? 's' : ''}
            </span>
          </div>

          {isLoading ? (
            <p className="font-mono text-xs text-muted-foreground">Loading positions...</p>
          ) : openPositions.length === 0 ? (
            <div className="py-8 text-center">
              <Wallet className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="font-mono text-sm text-muted-foreground">No open positions</p>
              <p className="font-mono text-xs text-muted-foreground/60 mt-1">
                Execute a paper trade from the dashboard to see positions here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Symbol</th>
                    <th className="pb-2 pr-4 font-medium text-right">Quantity</th>
                    <th className="pb-2 pr-4 font-medium text-right">Price</th>
                    <th className="pb-2 pr-4 font-medium text-right">Value</th>
                    <th className="pb-2 pr-4 font-medium text-right">24h Change</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map(([symbol, quantity]) => {
                    const p = prices[symbol];
                    const value = p ? quantity * p.price : null;
                    return (
                      <tr key={symbol} className="border-b border-border/30 text-xs">
                        <td className="py-2.5 pr-4">
                          <span className="font-mono font-semibold text-foreground">
                            {symbol}
                          </span>
                          <span className="text-muted-foreground">/USDT</span>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-foreground">
                          {numberFmt(quantity, 6)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-foreground">
                          {p ? `$${numberFmt(p.price)}` : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-foreground">
                          {value !== null ? `$${numberFmt(value)}` : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-right">
                          {p ? <PnlText value={p.change24h} suffix="%" /> : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Order History */}
        <section className="cyber-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-primary" />
            <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
              Recent Orders
            </h2>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {recentOrders.length} order{recentOrders.length !== 1 ? 's' : ''}
            </span>
          </div>

          {isLoading ? (
            <p className="font-mono text-xs text-muted-foreground">Loading orders...</p>
          ) : recentOrders.length === 0 ? (
            <div className="py-8 text-center">
              <TrendingDown className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
              <p className="font-mono text-sm text-muted-foreground">No orders yet</p>
              <p className="font-mono text-xs text-muted-foreground/60 mt-1">
                Paper trade orders will appear here after execution.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Time</th>
                    <th className="pb-2 pr-4 font-medium">Symbol</th>
                    <th className="pb-2 pr-4 font-medium">Side</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium text-right">Qty</th>
                    <th className="pb-2 pr-4 font-medium text-right">Price</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => {
                    const time = new Date(order.created_at * 1000);
                    const isBuy = order.side === 'BUY';
                    return (
                      <tr key={order.id} className="border-b border-border/30 text-xs">
                        <td className="py-2.5 pr-4 font-mono text-muted-foreground whitespace-nowrap">
                          {time.toLocaleDateString()} {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-2.5 pr-4 font-mono font-semibold text-foreground">
                          {order.symbol}
                        </td>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`inline-flex items-center gap-1 font-mono font-semibold ${
                              isBuy ? 'text-green-400' : 'text-red-400'
                            }`}
                          >
                            {isBuy ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {order.side}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-muted-foreground">
                          {order.order_type}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-foreground">
                          {numberFmt(order.quantity, 6)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono text-foreground">
                          {order.price !== null ? `$${numberFmt(order.price)}` : 'MARKET'}
                        </td>
                        <td className="py-2.5 font-mono">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              order.status === 'FILLED'
                                ? 'bg-green-400/10 text-green-400'
                                : order.status === 'REJECTED'
                                ? 'bg-red-400/10 text-red-400'
                                : 'bg-yellow-400/10 text-yellow-400'
                            }`}
                          >
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Separator className="my-6 bg-border" />

        <p className="text-center font-mono text-[10px] text-muted-foreground/60">
          PAPER MODE — All positions and balances are simulated. No real funds at risk.
        </p>
      </div>
    </main>
  );
}
