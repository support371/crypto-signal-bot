import { useBackendStatus } from '@/hooks/useBackendStatus';
import { Server, CheckCircle2, AlertCircle } from 'lucide-react';

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function BackendStatusCard() {
  const { health, isConnected, isLoading, error, backendUrl } = useBackendStatus(30000);

  return (
    <div className="rounded-lg border bg-card p-4 font-mono text-sm">
      <div className="flex items-center gap-2 mb-3 text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        <Server className="h-3.5 w-3.5" />
        Backend
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Connecting...</p>}
      {!isLoading && !isConnected && (
        <div className="flex items-center gap-1 text-destructive text-xs">
          <AlertCircle className="h-3.5 w-3.5" />
          {error ?? 'Unreachable'}
        </div>
      )}
      {isConnected && health && (
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className="text-green-500 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {health.status}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mode</span>
            <span>{health.mode}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Network</span>
            <span>{health.network}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Uptime</span>
            <span>{formatUptime(health.uptime_seconds)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">URL</span>
            <span className="truncate max-w-[140px]" title={backendUrl}>{backendUrl}</span>
          </div>
        </div>
      )}
    </div>
  );
}
