/**
 * BackendStatusCard — compact card showing backend health snapshot.
 */
import { Server, Clock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NormalizedBackendHealth } from "@/hooks/useBackendStatus";

interface BackendStatusCardProps {
  health: NormalizedBackendHealth | null;
  isConnected: boolean;
  isLoading?: boolean;
}

function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

export function BackendStatusCard({ health, isConnected, isLoading }: BackendStatusCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 font-mono">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Server className="h-4 w-4 text-accent" />
          Backend
        </div>
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full",
            isConnected
              ? "bg-green-900/30 text-green-400"
              : "bg-red-900/30 text-red-400"
          )}
        >
          <span
            className={cn("h-1.5 w-1.5 rounded-full", isConnected ? "bg-green-400" : "bg-red-400")}
          />
          {isConnected ? "ONLINE" : "OFFLINE"}
        </div>
      </div>

      {health ? (
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>Mode<br /><span className="text-foreground uppercase">{health.mode}</span></div>
          <div>Network<br /><span className="text-foreground uppercase">{health.network}</span></div>
          <div>
            <Clock className="h-3 w-3 inline mr-1" />
            Uptime<br />
            <span className="text-foreground">{fmtUptime(health.uptime_seconds)}</span>
          </div>
          <div>Kill Switch<br />
            <span className={health.kill_switch_active ? "text-red-400" : "text-green-400"}>
              {health.kill_switch_active ? "ACTIVE" : "CLEAR"}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {isLoading ? "Loading..." : "No health data available"}
        </p>
      )}

      {health?.kill_switch_active && health.kill_switch_reason && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
          <ShieldAlert className="h-3.5 w-3.5 flex-shrink-0" />
          {health.kill_switch_reason}
        </div>
      )}
    </div>
  );
}
