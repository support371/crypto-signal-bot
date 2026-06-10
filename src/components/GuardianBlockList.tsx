/**
 * GuardianBlockList — shows active strategy and venue kill-switch blocks.
 */
import { Ban, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface GuardianBlockListProps {
  strategyBlocks?: string[];
  venueBlocks?: string[];
  className?: string;
}

export function GuardianBlockList({
  strategyBlocks = [],
  venueBlocks = [],
  className,
}: GuardianBlockListProps) {
  const total = strategyBlocks.length + venueBlocks.length;

  if (total === 0) {
    return (
      <div className={cn("text-xs text-muted-foreground font-mono", className)}>
        No active blocks
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 font-mono", className)}>
      {strategyBlocks.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Ban className="h-3 w-3" /> Strategy blocks ({strategyBlocks.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {strategyBlocks.map((id) => (
              <span
                key={id}
                className="px-2 py-0.5 rounded text-xs bg-red-950/40 text-red-400 border border-red-900/30"
              >
                {id}
              </span>
            ))}
          </div>
        </div>
      )}
      {venueBlocks.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
            <Zap className="h-3 w-3" /> Venue blocks ({venueBlocks.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {venueBlocks.map((id) => (
              <span
                key={id}
                className="px-2 py-0.5 rounded text-xs bg-amber-950/40 text-amber-400 border border-amber-900/30"
              >
                {id}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
