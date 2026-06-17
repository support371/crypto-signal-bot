import { useBackendStatus } from '@/hooks/useBackendStatus';
import { ShieldX } from 'lucide-react';

export function GuardianBlockList() {
  const { health } = useBackendStatus(30000);

  if (!health?.guardian_triggered) return null;

  return (
    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 font-mono text-sm">
      <div className="flex items-center gap-2 mb-2 text-yellow-500 font-semibold text-xs uppercase tracking-wider">
        <ShieldX className="h-3.5 w-3.5" />
        Guardian Active
      </div>
      <p className="text-xs text-muted-foreground">
        Guardian has triggered. Trade execution may be restricted.
        {health.kill_switch_reason && (
          <span className="block mt-1">Reason: {health.kill_switch_reason}</span>
        )}
      </p>
      {(health.api_error_count > 0 || health.failed_order_count > 0) && (
        <div className="mt-2 space-y-0.5 text-xs">
          {health.api_error_count > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">API errors</span>
              <span className="text-destructive">{health.api_error_count}</span>
            </div>
          )}
          {health.failed_order_count > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Failed orders</span>
              <span className="text-destructive">{health.failed_order_count}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
