import { Activity, AlertOctagon, Ban, Gauge, RefreshCw, TrendingUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BackendMetricsSnapshot } from '@/hooks/useBackendMetrics';

interface SystemMetricsPanelProps {
  metrics: BackendMetricsSnapshot | null;
  isLoading?: boolean;
  error?: string | null;
  onRefetch?: () => void;
}

function fmtNumber(value: number, digits = 0) {
  return value.toFixed(digits);
}

function fmtPnl(value: number) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function SystemMetricsPanel({ metrics, isLoading, error, onRefetch }: SystemMetricsPanelProps) {
  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-36 bg-muted rounded mb-4" />
        <div className="h-28 bg-muted rounded" />
      </div>
    );
  }

  const cards = [
    {
      label: 'Orders',
      value: fmtNumber(metrics?.ordersTotal ?? 0),
      detail: `${fmtNumber(metrics?.buyOrders ?? 0)} buy / ${fmtNumber(metrics?.sellOrders ?? 0)} sell`,
      icon: TrendingUpDown,
      tone: 'text-accent',
    },
    {
      label: 'Risk Blocks',
      value: fmtNumber(metrics?.riskBlocksTotal ?? 0),
      detail: 'guardian or risk-engine rejections',
      icon: Ban,
      tone: 'text-warning',
    },
    {
      label: 'Kill Switch',
      value: fmtNumber(metrics?.killSwitchTriggers ?? 0),
      detail: 'manual or guardian activations',
      icon: AlertOctagon,
      tone: 'text-destructive',
    },
    {
      label: 'API Errors',
      value: fmtNumber(metrics?.apiErrorsTotal ?? 0),
      detail: 'backend transport failures seen',
      icon: Activity,
      tone: 'text-muted-foreground',
    },
  ] as const;

  return (
    <div className="cyber-card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-primary">
            System Metrics
          </h3>
        </div>
        {onRefetch && (
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            onClick={onRefetch}
            title="Refresh backend metrics"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!metrics?.available ? (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-5">
          <p className="text-sm text-muted-foreground">
            {error || 'Prometheus metrics are not available in this backend runtime.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {cards.map(({ label, value, detail, icon: Icon, tone }) => (
              <div key={label} className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
                <div className="flex items-center gap-2">
                  <Icon className={cn('h-3.5 w-3.5', tone)} />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
                </div>
                <div className={cn('mt-2 text-lg font-mono font-semibold', tone)}>
                  {value}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-accent/10 border border-accent/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Realized P&L</div>
              <div className={cn(
                'mt-1 text-sm font-mono font-semibold',
                (metrics.pnlRealized ?? 0) >= 0 ? 'text-accent' : 'text-destructive',
              )}>
                {fmtPnl(metrics.pnlRealized ?? 0)}
              </div>
            </div>
            <div className="rounded-lg bg-secondary/10 border border-secondary/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Unrealized P&L</div>
              <div className={cn(
                'mt-1 text-sm font-mono font-semibold',
                (metrics.pnlUnrealized ?? 0) >= 0 ? 'text-accent' : 'text-destructive',
              )}>
                {fmtPnl(metrics.pnlUnrealized ?? 0)}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
