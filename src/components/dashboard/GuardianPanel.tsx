import { useState } from 'react';
import { Shield, ShieldAlert, ShieldOff, AlertTriangle, Zap, LockOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { fetchBackendJson } from '@/lib/backend';
import { toast } from 'sonner';

export interface GuardianStatus {
  triggered: boolean;
  trigger_reason: string | null;
  trigger_ts: number | null;
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  drawdown_pct: number;
  api_error_count: number;
  failed_order_count: number;
  thresholds: {
    max_api_errors: number;
    max_failed_orders: number;
    max_drawdown_pct: number;
  };
  market_data?: {
    exchange: string | null;
    market_data_mode: string;
    connected: boolean;
    connection_state: string;
    fallback_active: boolean;
    last_update_ts: number | null;
    last_error: string | null;
    stale: boolean;
    source: string;
  };
}

interface GuardianPanelProps {
  guardian: GuardianStatus | null;
  isLoading?: boolean;
  authEnabled?: boolean;
  onKillSwitchToggle?: () => void;
}

export function GuardianPanel({ guardian, isLoading, authEnabled, onKillSwitchToggle }: GuardianPanelProps) {
  const [toggling, setToggling] = useState(false);

  const handleKillSwitchToggle = async () => {
    if (!guardian) return;
    setToggling(true);
    try {
      const activate = !guardian.kill_switch_active;
      await fetchBackendJson('/kill-switch', {
        method: 'POST',
        body: JSON.stringify({
          activate,
          reason: activate ? 'Manual operator activation' : undefined,
        }),
      });
      toast[activate ? 'warning' : 'success'](
        activate ? 'Kill switch activated — trading halted' : 'Kill switch deactivated — trading resumed'
      );
      onKillSwitchToggle?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle kill switch';
      toast.error(msg);
    } finally {
      setToggling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="cyber-card p-6 animate-pulse">
        <div className="h-6 w-36 bg-muted rounded mb-4" />
        <div className="h-32 bg-muted rounded" />
      </div>
    );
  }

  const isHalted = guardian?.kill_switch_active ?? false;
  const isTriggered = guardian?.triggered ?? false;
  const drawdown = guardian?.drawdown_pct ?? 0;
  const maxDrawdown = guardian?.thresholds.max_drawdown_pct ?? 5;
  const apiErrors = guardian?.api_error_count ?? 0;
  const maxApiErrors = guardian?.thresholds.max_api_errors ?? 10;
  const failedOrders = guardian?.failed_order_count ?? 0;
  const maxFailedOrders = guardian?.thresholds.max_failed_orders ?? 5;
  const marketData = guardian?.market_data;

  const headerIcon = isHalted
    ? ShieldOff
    : isTriggered
    ? ShieldAlert
    : Shield;

  const headerColor = isHalted
    ? 'text-destructive'
    : isTriggered
    ? 'text-warning'
    : 'text-accent';

  const headerLabel = isHalted ? 'TRADING HALTED' : isTriggered ? 'ALERT' : 'GUARDIAN ACTIVE';

  return (
    <div className={cn(
      'cyber-card p-6',
      isHalted && 'border-destructive/50 bg-destructive/5',
    )}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {(() => {
            const Icon = headerIcon;
            return <Icon className={cn('w-4 h-4', headerColor)} />;
          })()}
          <h3 className={cn(
            'font-display text-sm font-semibold uppercase tracking-wider',
            headerColor,
          )}>
            {headerLabel}
          </h3>
        </div>

        <Button
          size="sm"
          variant={isHalted ? 'outline' : 'destructive'}
          className={cn(
            'h-7 px-3 text-xs font-mono',
            !isHalted && 'border-destructive/50 hover:bg-destructive hover:text-destructive-foreground',
          )}
          onClick={handleKillSwitchToggle}
          disabled={toggling}
        >
          <Zap className="w-3 h-3 mr-1" />
          {isHalted ? 'RESUME' : 'HALT'}
        </Button>
      </div>

      {/* Auth warning */}
      {authEnabled === false && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 flex items-center gap-2">
          <LockOpen className="w-3 h-3 text-warning shrink-0" />
          <p className="text-xs font-mono text-warning">
            Kill switch is unauthenticated — set <span className="font-bold">BACKEND_API_KEY</span> to restrict access.
          </p>
        </div>
      )}

      {/* Trigger reason */}
      {(guardian?.kill_switch_reason || guardian?.trigger_reason) && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
          <p className="text-xs font-mono text-destructive leading-relaxed">
            {guardian.kill_switch_reason || guardian.trigger_reason}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {marketData && (
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Market Data</span>
              <span className={cn('font-mono', marketData.connected ? 'text-accent' : 'text-warning')}>
                {marketData.market_data_mode === 'live_public_paper' ? 'LIVE PAPER' : 'SYNTHETIC'}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-[11px] font-mono text-muted-foreground">
              <span>{marketData.source || 'synthetic'}</span>
              <span>
                {marketData.connection_state}
                {marketData.fallback_active ? ' / fallback' : ''}
                {marketData.stale ? ' / stale' : ''}
              </span>
            </div>
          </div>
        )}

        {/* Drawdown */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Drawdown</span>
            <span className={cn(
              'font-mono',
              drawdown >= maxDrawdown ? 'text-destructive' :
              drawdown >= maxDrawdown * 0.7 ? 'text-warning' : 'text-accent',
            )}>
              {drawdown.toFixed(1)}% / {maxDrawdown}%
            </span>
          </div>
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                drawdown >= maxDrawdown ? 'bg-destructive' :
                drawdown >= maxDrawdown * 0.7 ? 'bg-warning' : 'bg-accent',
              )}
              style={{ width: `${Math.min((drawdown / maxDrawdown) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* API errors */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">API Errors</span>
            <span className={cn(
              'font-mono',
              apiErrors >= maxApiErrors ? 'text-destructive' :
              apiErrors >= maxApiErrors * 0.7 ? 'text-warning' : 'text-muted-foreground',
            )}>
              {apiErrors} / {maxApiErrors}
            </span>
          </div>
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                apiErrors >= maxApiErrors ? 'bg-destructive' :
                apiErrors >= maxApiErrors * 0.7 ? 'bg-warning' : 'bg-muted-foreground/40',
              )}
              style={{ width: `${Math.min((apiErrors / maxApiErrors) * 100, 100)}%` }}
            />
          </div>
        </div>

        {/* Failed orders */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Failed Orders</span>
            <span className={cn(
              'font-mono',
              failedOrders >= maxFailedOrders ? 'text-destructive' :
              failedOrders >= maxFailedOrders * 0.7 ? 'text-warning' : 'text-muted-foreground',
            )}>
              {failedOrders} / {maxFailedOrders}
            </span>
          </div>
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                failedOrders >= maxFailedOrders ? 'bg-destructive' :
                failedOrders >= maxFailedOrders * 0.7 ? 'bg-warning' : 'bg-muted-foreground/40',
              )}
              style={{ width: `${Math.min((failedOrders / maxFailedOrders) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
