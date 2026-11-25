import { useBackendStatus } from '@/hooks/useBackendStatus';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useGuardianStatus } from '@/hooks/useGuardianStatus';
import { useExchangeStatus } from '@/hooks/useExchangeStatus';
import { Button } from '@/components/ui/button';
import {
  HeartPulse,
  RefreshCw,
  Wifi,
  Shield,
  Clock,
  Activity,
  Server,
  AlertTriangle,
  Play,
} from 'lucide-react';

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`}
    />
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function Health() {
  const { health, isLoading: healthLoading, refetch: refetchHealth } = useBackendStatus(15000);
  const { status: monitor, isLoading: monitorLoading, runNow } = useMonitoring(30000);
  const { guardian } = useGuardianStatus(15000);
  const { status: exchange } = useExchangeStatus(30000);

  return (
    <main className="min-h-screen bg-background scanlines">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2">
              <HeartPulse className="h-5 w-5 text-primary" />
              <h1 className="font-display text-2xl font-bold tracking-wide text-foreground">
                System Health
              </h1>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Service status, probes, and connectivity
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => runNow()}
              className="font-mono text-xs"
            >
              <Play className="mr-1.5 h-3 w-3" />
              Run Probes
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchHealth()}
              className="font-mono text-xs"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Overall Status Banner */}
        {health && (
          <div
            className={`cyber-card mb-6 p-4 ${
              health.status === 'ok'
                ? 'border-green-500/30'
                : 'border-red-500/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <StatusDot ok={health.status === 'ok'} />
              <span className="font-mono text-sm font-semibold text-foreground">
                {health.status === 'ok' ? 'All Systems Operational' : 'Degraded'}
              </span>
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                Uptime: {formatUptime(health.uptime_seconds)}
              </span>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Backend Service */}
          <section className="cyber-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Server className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Backend Service
              </h2>
            </div>
            {healthLoading ? (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            ) : health ? (
              <div className="space-y-0.5">
                <InfoRow
                  label="Status"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={health.status === 'ok'} />
                      {health.status}
                    </span>
                  }
                />
                <InfoRow label="Service" value={health.service} />
                <InfoRow label="Runtime" value={health.runtime} />
                <InfoRow label="Mode" value={health.mode} />
                <InfoRow label="Network" value={health.network} />
                <InfoRow label="Uptime" value={formatUptime(health.uptime_seconds)} />
              </div>
            ) : (
              <p className="font-mono text-xs text-red-400">Backend unreachable</p>
            )}
          </section>

          {/* Guardian */}
          <section className="cyber-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-accent" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Guardian
              </h2>
            </div>
            {guardian ? (
              <div className="space-y-0.5">
                <InfoRow
                  label="Kill Switch"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={!guardian.kill_switch_active} />
                      {guardian.kill_switch_active ? 'ACTIVE' : 'Inactive'}
                    </span>
                  }
                />
                <InfoRow
                  label="Triggered"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={!guardian.triggered} />
                      {guardian.triggered ? 'Yes' : 'No'}
                    </span>
                  }
                />
                <InfoRow label="API Errors" value={guardian.api_error_count} />
                <InfoRow label="Failed Orders" value={guardian.failed_order_count} />
                <InfoRow
                  label="Drawdown"
                  value={`${(guardian.drawdown_pct * 100).toFixed(2)}%`}
                />
                {guardian.kill_switch_reason && (
                  <InfoRow label="Reason" value={guardian.kill_switch_reason} />
                )}
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            )}
          </section>

          {/* Market Data */}
          <section className="cyber-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Wifi className="h-4 w-4 text-green-400" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Market Data
              </h2>
            </div>
            {exchange ? (
              <div className="space-y-0.5">
                <InfoRow
                  label="Connection"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={exchange.connected} />
                      {exchange.connection_state}
                    </span>
                  }
                />
                <InfoRow label="Source" value={exchange.source} />
                <InfoRow label="Mode" value={exchange.market_data_mode} />
                <InfoRow
                  label="Stale"
                  value={
                    <span className="flex items-center gap-1.5">
                      <StatusDot ok={!exchange.stale} />
                      {exchange.stale ? 'Yes' : 'No'}
                    </span>
                  }
                />
                <InfoRow
                  label="Fallback Active"
                  value={exchange.fallback_active ? 'Yes' : 'No'}
                />
                <InfoRow label="Symbols" value={exchange.symbols.join(', ')} />
                {exchange.last_error && (
                  <InfoRow label="Last Error" value={exchange.last_error} />
                )}
              </div>
            ) : (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            )}
          </section>

          {/* Monitoring Probes */}
          <section className="cyber-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-primary" />
              <h2 className="font-display text-sm font-semibold tracking-wide text-foreground">
                Monitoring Probes
              </h2>
            </div>
            {monitorLoading ? (
              <p className="font-mono text-xs text-muted-foreground">Loading...</p>
            ) : monitor ? (
              <div>
                <div className="space-y-0.5 mb-3">
                  <InfoRow
                    label="Overall"
                    value={
                      <span className="flex items-center gap-1.5">
                        <StatusDot ok={monitor.overall_ok} />
                        {monitor.overall_ok ? 'Healthy' : 'Degraded'}
                      </span>
                    }
                  />
                  <InfoRow label="Run Count" value={monitor.run_count} />
                  <InfoRow
                    label="Interval"
                    value={`${monitor.probe_interval}s`}
                  />
                </div>
                {Object.entries(monitor.probes).length > 0 && (
                  <div className="space-y-1.5 border-t border-border pt-3">
                    <span className="text-xs text-muted-foreground">Probes</span>
                    {Object.entries(monitor.probes).map(([name, probe]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between rounded border border-border/30 px-3 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <StatusDot ok={probe.ok === true} />
                          <span className="font-mono text-xs text-foreground">
                            {name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          {probe.latency_ms !== null && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {probe.latency_ms}ms
                            </span>
                          )}
                          {probe.consecutive_failures > 0 && (
                            <span className="font-mono text-[10px] text-red-400">
                              {probe.consecutive_failures} fail
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-4 text-center">
                <AlertTriangle className="mx-auto h-6 w-6 text-muted-foreground/40 mb-2" />
                <p className="font-mono text-xs text-muted-foreground">
                  Monitor not available
                </p>
              </div>
            )}
          </section>
        </div>

        <p className="mt-6 text-center font-mono text-[10px] text-muted-foreground/60">
          PAPER MODE — Health data reflects the paper trading backend
        </p>
      </div>
    </main>
  );
}
