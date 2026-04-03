import { useState } from 'react';
import { Wallet, TrendingUp, TrendingDown, ArrowUpDown, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { fetchBackendJson } from '@/lib/backend';
import { toast } from 'sonner';
import type { PortfolioState, PaperOrder } from '@/hooks/usePortfolio';
import { Signal, RiskAssessment } from '@/types/crypto';

interface QuickTradeProps {
  symbol: string;
  signal: Signal | null;
  risk: RiskAssessment | null;
  price: number;
  onFilled: () => void;
}

function QuickTrade({ symbol, signal, risk, price, onFilled }: QuickTradeProps) {
  const [submitting, setSubmitting] = useState(false);

  const canTrade = signal && risk && risk.approved && !risk.positionSize === false;

  const handleTrade = async (side: 'BUY' | 'SELL') => {
    if (!risk) return;
    setSubmitting(true);
    try {
      const qty = price > 0 ? Number(((risk.positionSize * 1000) / price).toFixed(6)) : 0.001;
      await fetchBackendJson('/intent/paper', {
        method: 'POST',
        body: JSON.stringify({
          symbol: `${symbol}USDT`,
          side,
          order_type: 'MARKET',
          quantity: Math.max(qty, 0.0001),
        }),
      });
      toast.success(`Paper ${side} submitted for ${symbol}`);
      onFilled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Trade failed');
    } finally {
      setSubmitting(false);
    }
  };

  const side = signal?.direction === 'DOWN' ? 'SELL' : 'BUY';

  return (
    <div className="flex gap-2 mt-3 pt-3 border-t border-border/50">
      <Button
        size="sm"
        variant="outline"
        className={cn(
          'flex-1 h-8 text-xs font-mono',
          side === 'BUY'
            ? 'border-accent/50 text-accent hover:bg-accent/10'
            : 'border-destructive/50 text-destructive hover:bg-destructive/10'
        )}
        onClick={() => handleTrade(side)}
        disabled={submitting || !canTrade}
        title={!canTrade ? 'Signal not approved for trading' : `Execute paper ${side}`}
      >
        {submitting ? (
          <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
        ) : side === 'BUY' ? (
          <TrendingUp className="w-3 h-3 mr-1" />
        ) : (
          <TrendingDown className="w-3 h-3 mr-1" />
        )}
        PAPER {side}
      </Button>
    </div>
  );
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

function orderTimeLabel(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function statusColor(status: string): string {
  switch (status) {
    case 'FILLED': return 'text-accent';
    case 'FAILED': return 'text-destructive';
    case 'RISK_REJECTED': return 'text-warning';
    default: return 'text-muted-foreground';
  }
}

interface PortfolioPanelProps {
  portfolio: PortfolioState | null;
  isLoading?: boolean;
  selectedSymbol?: string;
  selectedPrice?: number;
  signal?: Signal | null;
  risk?: RiskAssessment | null;
  onRefetch?: () => void;
}

export function PortfolioPanel({
  portfolio,
  isLoading,
  selectedSymbol = 'BTC',
  selectedPrice = 0,
  signal,
  risk,
  onRefetch,
}: PortfolioPanelProps) {
  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded mb-4" />
        <div className="h-24 bg-muted rounded" />
      </div>
    );
  }

  const usdt = portfolio?.balances?.USDT ?? 0;
  const nonUsdtBalances = Object.entries(portfolio?.balances ?? {}).filter(
    ([k, v]) => k !== 'USDT' && v > 0
  );
  const recentOrders: PaperOrder[] = (portfolio?.orders ?? []).slice(-5).reverse();

  return (
    <div className="cyber-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          <h3 className="font-display text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Paper Portfolio
          </h3>
        </div>
        {onRefetch && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onRefetch}
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Balances */}
      <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground font-mono">USDT</span>
          <span className="text-sm font-mono font-semibold text-foreground">
            {currency.format(usdt)}
          </span>
        </div>
        {nonUsdtBalances.map(([asset, qty]) => (
          <div key={asset} className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground font-mono">{asset}</span>
            <span className="text-sm font-mono text-accent">{compact.format(qty)}</span>
          </div>
        ))}
        {nonUsdtBalances.length === 0 && (
          <p className="text-xs text-muted-foreground/60">No open positions</p>
        )}
      </div>

      {/* Recent orders */}
      {recentOrders.length > 0 && (
        <div className="border-t border-border/50 pt-3">
          <div className="flex items-center gap-1.5 mb-2">
            <ArrowUpDown className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Recent Orders</span>
          </div>
          <div className="space-y-1.5">
            {recentOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      'font-mono font-semibold',
                      o.side === 'BUY' ? 'text-accent' : 'text-destructive'
                    )}
                  >
                    {o.side}
                  </span>
                  <span className="text-muted-foreground">{o.symbol}</span>
                  <span className="text-muted-foreground/60">{compact.format(o.quantity)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('font-mono', statusColor(o.status))}>{o.status}</span>
                  <span className="text-muted-foreground/40">{orderTimeLabel(o.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick trade */}
      <QuickTrade
        symbol={selectedSymbol}
        signal={signal ?? null}
        risk={risk ?? null}
        price={selectedPrice}
        onFilled={() => onRefetch?.()}
      />
    </div>
  );
}
