import { useState } from 'react';
import { Shield, ShieldAlert, ShieldOff, AlertTriangle, Zap, LockOpen, Ban, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchBackendJson } from '@/lib/backend';
import { toast } from 'sonner';

export interface GuardianStatus {
  triggered: boolean;
  trigger_reason: string | null;
  trigger_ts?: number | null;
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  drawdown_pct: number;
  api_error_count: number;
  failed_order_count: number;
  reconciliation_drift_count?: number;
  reconciliation_drift_active?: boolean;
  reconciliation_drift_reason?: string | null;
  strategy_kill_switches?: string[];
  venue_kill_switches?: string[];
  thresholds: {
    max_api_errors: number;
    max_failed_orders: number;
    max_drawdown_pct: number;
    reconciliation_drift_tolerance_cycles?: number;
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

type ScopeType = 'strategy' | 'venue';

export function GuardianPanel({ guardian, isLoading, authEnabled, onKillSwitchToggle }: GuardianPanelProps) {
  const [toggling, setToggling] = useState(false);
  const [scopeBusy, setScopeBusy] = useState<string | null>(null);
  const [strategyId, setStrategyId] = useState('');
  const [venueId, setVenueId] = useState('');

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

  const toggleScope = async (scopeType: ScopeType, scopeId: string, activate: boolean) => {
    const normalized = scopeId.trim().toLowerCase();
    if (!normalized) {
      toast.error(`Enter a ${scopeType} id first`);
      return;
    }

    const busyKey = `${scopeType}:${normalized}`;
    setScopeBusy(busyKey);
    try {
      await fetchBackendJson('/kill-switch/scope', {
        method: 'POST',
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: normalized,
          activate,
          reason: `Dashboard ${activate ? 'activation' : 'reset'} for ${scopeType} ${normalized}`,
        }),
      });
      toast[activate ? 'warning' : 'success'](
        activate
          ? `${scopeType} ${normalized} kill switch activated`
          : `${scopeType} ${normalized} kill switch cleared`
      );
      if (activate) {
        if (scopeType === 'strategy') setStrategyId('');
        if (scopeType === 'venue') setVenueId('');
      }
      onKillSwitchToggle?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : `Failed to update ${scopeType} kill switch`;
      toast.error(msg);
    } finally {
      setScopeBusy(null);
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
  const driftCount = guardian?.reconciliation_drift_count ?? 0;
  const driftTolerance = guardian?.thresholds.reconciliation_drift_tolerance_cycles ?? 3;
  const marketData = guardian?.market_data;
  const strategyKills = guardian?.strategy_kill_switches ?? [];
  const venueKills = guardian?.venue_kill_switches ?? [];

  const headerIcon = isHalted ? ShieldOff : isTriggered ? ShieldAlert : Shield;
  const headerColor = isHalted ? 'text-destructive' : isTriggered ? 'text-warning' : 'text-accent';
  const headerLabel = isHalted ? 'TRADING HALTED' : isTriggered ? 'ALERT' : 'GUARDIAN ACTIVE';

  return (
    <div className={cn('cyber-card p-6', isHalted && 'border-destructive/50 bg-destructive/5')}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {(() => {
            const Icon = headerIcon;
            return <Icon className={cn('w-4 h-4', headerColor)} />;
          })()}
          <h3 className={cn('font-display text-sm font-semibold uppercase tracking-wider', headerColor)}>
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

      {authEnabled === false && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-warning/10 border border-warning/30 flex items-center gap-2">
          <LockOpen className="w-3 h-3 text-warning shrink-0" />
          <p className="text-xs font-mono text-warning">
            Kill switch is unauthenticated — set <span className="font-bold">BACKEND_API_KEY</span> to restrict access.
          </p>
        </div>
      )}

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

        <Meter label="Drawdown" value={drawdown} max={maxDrawdown} suffix="%" />
        <Meter label="API Errors" value={apiErrors} max={maxApiErrors} />
        <Meter label="Failed Orders" value={failedOrders} max={maxFailedOrders} />
        <Meter label="Recon Drift" value={driftCount} max={driftTolerance} />

        {guardian?.reconciliation_drift_reason && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] font-mono text-warning">
            {guardian.reconciliation_drift_reason}
          </div>
        )}

        <ScopeControl
          title="Strategy kill switches"
          scopeType="strategy"
          value={strategyId}
          onValueChange={setStrategyId}
          activeScopes={strategyKills}
          busyKey={scopeBusy}
          onToggle={toggleScope}
        />

        <ScopeControl
          title="Venue kill switches"
          scopeType="venue"
          value={venueId}
          onValueChange={setVenueId}
          activeScopes={venueKills}
          busyKey={scopeBusy}
          onToggle={toggleScope}
        />
      </div>
    </div>
  );
}

function Meter({ label, value, max, suffix = '' }: { label: string; value: number; max: number; suffix?: string }) {
  const warn = value >= max * 0.7;
  const fail = value >= max;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-mono', fail ? 'text-destructive' : warn ? 'text-warning' : 'text-muted-foreground')}>
          {Number(value).toFixed(suffix ? 1 : 0)}{suffix} / {max}{suffix}
        </span>
      </div>
      <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', fail ? 'bg-destructive' : warn ? 'bg-warning' : 'bg-muted-foreground/40')}
          style={{ width: `${Math.min((value / Math.max(max, 1)) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ScopeControl({
  title,
  scopeType,
  value,
  onValueChange,
  activeScopes,
  busyKey,
  onToggle,
}: {
  title: string;
  scopeType: ScopeType;
  value: string;
  onValueChange: (value: string) => void;
  activeScopes: string[];
  busyKey: string | null;
  onToggle: (scopeType: ScopeType, scopeId: string, activate: boolean) => Promise<void>;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-display uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className={cn('text-[11px] font-mono', activeScopes.length ? 'text-warning' : 'text-accent')}>
          {activeScopes.length} active
        </span>
      </div>

      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={`${scopeType} id`}
          className="h-8 text-xs font-mono"
        />
        <Button
          size="sm"
          variant="destructive"
          className="h-8 px-3 text-xs font-mono"
          disabled={busyKey === `${scopeType}:${value.trim().toLowerCase()}`}
          onClick={() => onToggle(scopeType, value, true)}
        >
          <Ban className="w-3 h-3 mr-1" />
          Kill
        </Button>
      </div>

      {activeScopes.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {activeScopes.map((scope) => (
            <button
              key={scope}
              className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] font-mono text-warning hover:bg-warning/20"
              disabled={busyKey === `${scopeType}:${scope}`}
              onClick={() => onToggle(scopeType, scope, false)}
            >
              {scope}
              <RotateCcw className="w-3 h-3" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
