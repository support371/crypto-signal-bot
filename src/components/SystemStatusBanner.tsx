/**
 * SystemStatusBanner — shows backend connectivity at the top of the app.
 * Replaces the hard-coded "Backend unavailable" red box in Index.tsx.
 */
import { AlertTriangle, CheckCircle2, WifiOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SystemStatusBannerProps {
  isConnected: boolean;
  isLoading: boolean;
  backendUrl: string;
  error?: string | null;
}

export function SystemStatusBanner({
  isConnected,
  isLoading,
  backendUrl,
  error,
}: SystemStatusBannerProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/40 text-muted-foreground font-mono text-xs border-b border-border">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Connecting to backend...</span>
        <span className="opacity-50 ml-1">{backendUrl}</span>
      </div>
    );
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-2 px-4 py-1.5 bg-green-950/30 text-green-400 font-mono text-xs border-b border-green-900/30">
        <CheckCircle2 className="h-3 w-3" />
        <span>Backend connected</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 px-4 py-2 bg-red-950/40 text-red-400 font-mono text-xs border-b border-red-900/40">
      <div className="flex items-center gap-2">
        <WifiOff className="h-3.5 w-3.5 flex-shrink-0" />
        <span className="font-semibold">
          {error || "Backend unavailable. Market state, health, and paper balance are offline."}
        </span>
      </div>
      <span className="sm:ml-2 opacity-60">Backend URL: {backendUrl}</span>
    </div>
  );
}
