/**
 * src/components/BackendUnavailable.tsx
 *
 * PHASE 13 — Explicit unavailable state component.
 *
 * Replaces any remaining placeholder/demo fallback rendering.
 * When backend is unreachable: show this — never fabricated metrics.
 */

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface BackendUnavailableProps {
  reason?: string;
  className?: string;
}

export function BackendUnavailable({ reason, className }: BackendUnavailableProps) {
  return (
    <div
      className={cn(
        "cyber-card p-6 border-warning/50 bg-warning/5 flex flex-col items-center justify-center gap-3 min-h-[120px]",
        className
      )}
    >
      <AlertTriangle className="w-6 h-6 text-warning" />
      <div className="text-center">
        <p className="text-sm font-mono text-warning font-semibold uppercase tracking-wider">
          Data Unavailable
        </p>
        {reason && (
          <p className="text-xs text-muted-foreground mt-1 font-mono max-w-xs">
            {reason}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline unavailable badge — used inside data cells
// ---------------------------------------------------------------------------

export function UnavailableBadge({ label = "—" }: { label?: string }) {
  return (
    <span className="text-xs font-mono text-muted-foreground/60 italic">
      {label}
    </span>
  );
}
