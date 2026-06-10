/**
 * SafeModePanel — displayed when backend is offline/unreachable.
 * Shows a friendly status screen instead of a broken dashboard.
 */
import { ShieldOff, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SafeModePanelProps {
  backendUrl: string;
  onRetry?: () => void;
}

export function SafeModePanel({ backendUrl, onRetry }: SafeModePanelProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6 font-mono">
      <ShieldOff className="h-16 w-16 text-amber-500 mb-6 opacity-80" />
      <h2 className="text-2xl font-bold text-foreground mb-2">Safe Mode</h2>
      <p className="text-muted-foreground mb-1 max-w-md">
        The backend is unreachable. No trading actions can be taken.
        Market data display is limited to public price feeds.
      </p>
      <p className="text-xs text-muted-foreground/60 mb-8">
        Backend URL: <span className="text-muted-foreground">{backendUrl}</span>
      </p>
      <div className="flex items-center gap-3">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry connection
          </Button>
        )}
        <Button variant="outline" size="sm" asChild className="gap-2">
          <a href={backendUrl + "/health"} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            Check backend
          </a>
        </Button>
      </div>
    </div>
  );
}
