/**
 * ExchangeStatusCard — compact card showing exchange / market-data feed status.
 */
import { Activity, AlertTriangle, CheckCircle2, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeStatus, FeedStatus } from "@/hooks/useExchangeStatus";

interface ExchangeStatusCardProps {
  exchangeStatus: ExchangeStatus | null;
  feedStatus: FeedStatus | null;
  isLoading?: boolean;
}

export function ExchangeStatusCard({
  exchangeStatus,
  feedStatus,
  isLoading,
}: ExchangeStatusCardProps) {
  const connected = exchangeStatus?.connected ?? false;
  const stale = exchangeStatus?.stale ?? true;
  const mode = exchangeStatus?.market_data_mode ?? "unknown";
  const exchange = exchangeStatus?.exchange ?? "—";
  const source = feedStatus?.source ?? exchangeStatus?.source ?? "—";

  const status = connected && !stale ? "ok" : connected ? "stale" : "offline";

  const statusColor = {
    ok: "text-green-400",
    stale: "text-amber-400",
    offline: "text-red-400",
  }[status];

  const StatusIcon = status === "ok"
    ? CheckCircle2
    : status === "stale"
    ? AlertTriangle
    : WifiOff;

  return (
    <div className="rounded-lg border border-border bg-card p-4 font-mono">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Activity className="h-4 w-4 text-accent" />
          Exchange Status
        </div>
        <div className={cn("flex items-center gap-1.5 text-xs", statusColor)}>
          <StatusIcon className="h-3.5 w-3.5" />
          {status.toUpperCase()}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>Exchange<br /><span className="text-foreground uppercase">{exchange}</span></div>
        <div>Mode<br /><span className="text-foreground uppercase">{mode}</span></div>
        <div>Source<br /><span className="text-foreground">{source}</span></div>
        <div>Symbols<br /><span className="text-foreground">{feedStatus?.symbol_count ?? exchangeStatus?.symbols?.length ?? "—"}</span></div>
      </div>
      {exchangeStatus?.last_error && (
        <p className="mt-2 text-xs text-red-400 truncate">{exchangeStatus.last_error}</p>
      )}
    </div>
  );
}
