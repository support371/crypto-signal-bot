import { useBackendStatus } from '@/hooks/useBackendStatus';
import { ShieldAlert } from 'lucide-react';

export function SafeModePanel() {
  const { health } = useBackendStatus(30000);

  if (!health?.kill_switch_active && !health?.halted) return null;

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 font-mono">
      <div className="flex items-center gap-2 text-destructive font-semibold mb-1">
        <ShieldAlert className="h-4 w-4" />
        Safe Mode Active
      </div>
      {health.kill_switch_reason && (
        <p className="text-sm text-muted-foreground">Reason: {health.kill_switch_reason}</p>
      )}
      <p className="text-xs text-muted-foreground mt-1">
        All trade execution is suspended. Guardian or kill switch has been triggered.
      </p>
    </div>
  );
}
