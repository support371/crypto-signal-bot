// src/components/dashboard/MonitoringPanel.tsx
import { Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { MonitorStatus, ProbeEntry } from '@/hooks/useMonitoring';

interface MonitoringPanelProps {
  status: MonitorStatus | null;
  isLoading?: boolean;
  onRunNow?: () => void;
  onRefetch?: () => void;
}

const PROBE_LABELS: Record<string, string> = {
  health:           'App Health',
  guardian:         'Guardian',
  market_data:      'Market Data',
  circuit_breakers: 'Circuit Breakers',
  signal_engine:    'Signal Engine',
  portfolio:        'Portfolio',
};

function ProbeRow({ name, entry }: { name: string; entry: ProbeEntry }) {
  const label = PROBE_LABELS[name] ?? name;
  const isOk = entry.ok === true;
  const isPending = entry.ok === null;
  const hasAlerted = entry.alerted;

  return (
    <div className={cn(
      'flex items-center justify-between py-2 px-3 rounded border text-xs font-mono transition-colors',
      isPending ? 'border-border bg-muted/20 text-muted-foreground' :
      isOk      ? 'border-accent/30 bg-accent/5 text-foreground' :
                  'border-destructive/50 bg-destructive/10 text-destructive'
    )}>
      <div className="flex items-center gap-2">
        {isPending ? (
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
        ) : isOk ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
        ) : (
          <XCircle className="w-3.5 h-3.5 text-destructive" />
        )}
        <span className={cn('font-medium', !isOk && !isPending && 'text-destructive')}>
          {label}
        </span>
        {!isOk && !isPending && entry.consecutive_failures > 0 && (
          <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">
            ×{entry.consecutive_failures}
          </Badge>
        )}
        {hasAlerted && !isOk && (
          <AlertTriangle className="w-3 h-3 text-amber-400" />
        )}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        {entry.latency_ms !== null && (
          <span>{entry.latency_ms}ms</span>
        )}
        {entry.ts && (
          <span>{new Date(entry.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
        )}
      </div>
    </div>
  );
}

export function MonitoringPanel({ status, isLoading, onRunNow, onRefetch }: MonitoringPanelProps) {
  const probes = status?.probes ?? {};
  const probeEntries = Object.entries(probes);
  const probeCount = probeEntries.length;
  const failCount = probeEntries.filter(([, p]) => p.ok === false).length;

  return (
    <div className="cyber-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className={cn(
            'w-4 h-4',
            !status || status.overall_ok ? 'text-accent' : 'text-destructive'
          )} />
          <span className="text-sm font-mono font-semibold tracking-wide text-foreground">
            SYSTEM MONITOR
          </span>
          {status && (
            <Badge
              variant={status.overall_ok ? 'outline' : 'destructive'}
              className={cn(\n                'text-[10px] px-1.5 py-0',
                status.overall_ok && 'border-accent/50 text-accent'
              )}
            >
              {status.overall_ok ? 'ALL CLEAR' : `${failCount} FAILING`}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] font-mono"
            onClick={onRunNow}
            disabled={isLoading}
            title="Force probe run"
          >
            <Activity className="w-3 h-3 mr-1" />
            RUN
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onRefetch}
            disabled={isLoading}
          >
            <RefreshCw className={cn('w-3 h-3', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Meta */}
      {status && (
        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
          <span>INTERVAL {status.probe_interval ?? '—#}s</span>
          <span>RUNS #{status.run_count ?? 0}</span>
          {(status.last_run_at ?? 0) > 0 && (
            <span>
              LAST {new Date((status.last_run_at ?? 0) * 1000).toLocaleTimeString([], {
                hour: '2-digit', minute: '2-digit', second: '2-digit'
              })}
            </span>
          )}
          {!status.running && (
            <span className="text-amber-400">⚠ LOOP NOT STARTED</span>
          )}
        </div>
      )}

      {/* Probe list */}
      {isLoading && !status ? (
        <div className="space-y-1.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-8 rounded bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : status && probeCount > 0 ? (
        <div className="space-y-1.5">
          {probeEntries.map((name, entry]) => (
            <ProbeRow key={name} name={name} entry={entry} />
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-muted-foreground font-mono text-xs">
          {status ? 'No probes have run yet — click RUN to trigger.' : 'Unable to reach monitoring service.'}
        </div>
      )}

      {/* Error details */}
      {status && failCount > 0 && (
        <div className="space-y-1">
          {probeEntries
            .filter(([, e]) => !e.ok && e.error)
            .map(([name, entry]) => (
              <p key={name} className="text-[10px] font-mono text-destructive/80 truncate">
                {PROBE_LABELS[name] ?? name}: {entry.error}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
