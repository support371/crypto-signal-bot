import { useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, BarChart3, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EarningsSummary, TradeRecord } from '@/hooks/useEarnings';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fetchBackendJson } from '@/lib/backend';
import { toast } from 'sonner';

interface EarningsPanelProps {
  summary: EarningsSummary | null;
  trades: TradeRecord[];
  isLoading?: boolean;
  onReset?: () => void;
}

function fmt(n: number, digits = 2) {
  return n.toFixed(digits);
}

function fmtPnl(n: number) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${fmt(Math.abs(n))}`;
}

export function EarningsPanel({ summary, trades, isLoading, onReset }: EarningsPanelProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-32 bg-muted rounded mb-4" />
        <div className="h-24 bg-muted rounded mb-3" />
        <div className="h-20 bg-muted rounded" />
      </div>
    );
  }

  const pnl = summary?.total_realized_pnl ?? 0;
  const pnlPositive = pnl >= 0;
  const tradeCount = summary?.trade_count ?? 0;
  const winRate = summary?.win_rate_pct ?? 0;
  const openLots = summary?.open_lots ?? 0;

  const handleReset = async () => {
    setResetting(true);
    try {
      await fetchBackendJson('/earnings/reset', { method: 'POST' });
      toast.success('Earnings ledger reset');
      setResetOpen(false);
      onReset?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reset earnings ledger');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="cyber-card p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="w-4 h-4 text-accent" />
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-accent">
          Earnings
        </h3>
        <div className="ml-auto flex items-center gap-3">
          {openLots > 0 && (
            <span className="text-xs font-mono text-muted-foreground">
              {openLots} open {openLots === 1 ? 'lot' : 'lots'}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] font-mono"
            onClick={() => setResetOpen(true)}
            disabled={resetting}
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            RESET
          </Button>
        </div>
      </div>

      {/* P&L headline */}
      <div className="mb-4">
        <div className={cn(
          'text-2xl font-display font-bold font-mono',
          pnlPositive ? 'text-accent' : 'text-destructive',
        )}>
          {fmtPnl(pnl)}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">Realized P&L (paper USDT)</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center">
          <div className="text-sm font-mono font-semibold">{tradeCount}</div>
          <div className="text-xs text-muted-foreground">Trades</div>
        </div>
        <div className="text-center">
          <div className={cn(
            'text-sm font-mono font-semibold',
            winRate >= 50 ? 'text-accent' : 'text-destructive',
          )}>
            {fmt(winRate)}%
          </div>
          <div className="text-xs text-muted-foreground">Win rate</div>
        </div>
        <div className="text-center">
          <div className={cn(
            'text-sm font-mono font-semibold',
            (summary?.avg_pnl_per_trade ?? 0) >= 0 ? 'text-accent' : 'text-destructive',
          )}>
            {summary ? fmtPnl(summary.avg_pnl_per_trade) : '—'}
          </div>
          <div className="text-xs text-muted-foreground">Avg/trade</div>
        </div>
      </div>

      {/* Best / Worst */}
      {tradeCount > 0 && summary && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="px-2 py-1.5 rounded-lg bg-accent/10 border border-accent/20">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingUp className="w-3 h-3 text-accent" />
              <span className="text-xs text-muted-foreground">Best</span>
            </div>
            <div className="text-xs font-mono text-accent font-semibold">
              {fmtPnl(summary.best_trade_pnl)}
            </div>
          </div>
          <div className="px-2 py-1.5 rounded-lg bg-destructive/10 border border-destructive/20">
            <div className="flex items-center gap-1 mb-0.5">
              <TrendingDown className="w-3 h-3 text-destructive" />
              <span className="text-xs text-muted-foreground">Worst</span>
            </div>
            <div className="text-xs font-mono text-destructive font-semibold">
              {fmtPnl(summary.worst_trade_pnl)}
            </div>
          </div>
        </div>
      )}

      {/* Recent trades */}
      {trades.length > 0 ? (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <BarChart3 className="w-3 h-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Recent trades</span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {trades.slice(0, 8).map((t, i) => (
              <div key={i} className="flex items-center justify-between text-xs font-mono">
                <span className="text-muted-foreground truncate max-w-[80px]">{t.symbol}</span>
                <span className={cn(
                  'font-semibold',
                  t.realized_pnl >= 0 ? 'text-accent' : 'text-destructive',
                )}>
                  {fmtPnl(t.realized_pnl)}
                </span>
                <span className={cn(
                  'text-muted-foreground',
                  t.pnl_pct >= 0 ? 'text-accent/70' : 'text-destructive/70',
                )}>
                  {t.pnl_pct >= 0 ? '+' : ''}{fmt(t.pnl_pct, 2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground font-mono text-center py-2">
          No closed trades yet
        </p>
      )}

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset Earnings Ledger?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears realized P&amp;L history from the backend paper ledger. Open lots and balances remain untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} disabled={resetting}>
              {resetting ? 'Resetting...' : 'Reset Ledger'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
