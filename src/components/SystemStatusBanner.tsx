import { useBackendStatus } from '@/hooks/useBackendStatus';
import { useStream } from '@/hooks/useStream';
import { AlertTriangle, CheckCircle2, WifiOff, Zap } from 'lucide-react';

export function SystemStatusBanner() {
  const { isConnected, health } = useBackendStatus(60000);
  const stream = useStream();

  const safeMode = health?.kill_switch_active || health?.halted;
  const wsOk = stream.connected;

  if (isConnected && !safeMode && wsOk) return null;

  return (
    <div className="w-full bg-destructive/10 border-b border-destructive/30 px-4 py-2 font-mono text-xs flex items-center gap-3">
      {safeMode && (
        <span className="flex items-center gap-1 text-destructive font-semibold">
          <AlertTriangle className="h-3.5 w-3.5" />
          SAFE MODE ACTIVE
          {health?.kill_switch_reason && ` — ${health.kill_switch_reason}`}
        </span>
      )}
      {!isConnected && (
        <span className="flex items-center gap-1 text-yellow-500">
          <WifiOff className="h-3.5 w-3.5" />
          Backend unreachable
        </span>
      )}
      {isConnected && !wsOk && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Zap className="h-3.5 w-3.5" />
          Stream {stream.status}
          {stream.reconnectAttempt > 0 && ` (attempt ${stream.reconnectAttempt})`}
        </span>
      )}
      {isConnected && !safeMode && wsOk && (
        <span className="flex items-center gap-1 text-green-500">
          <CheckCircle2 className="h-3.5 w-3.5" />
          All systems nominal
        </span>
      )}
    </div>
  );
}
