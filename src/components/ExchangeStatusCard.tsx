import { useExchangeStatus } from '@/hooks/useExchangeStatus';
import { Activity, AlertCircle, CheckCircle2 } from 'lucide-react';

export function ExchangeStatusCard() {
  const { status, error, isLoading } = useExchangeStatus(30000);

  return (
    <div className="rounded-lg border bg-card p-4 font-mono text-sm">
      <div className="flex items-center gap-2 mb-3 text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        <Activity className="h-3.5 w-3.5" />
        Exchange
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
      {error && (
        <div className="flex items-center gap-1 text-destructive text-xs">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </div>
      )}
      {status && (
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Exchange</span>
            <span>{status.exchange ?? 'paper'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Mode</span>
            <span>{status.trading_mode}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Feed</span>
            <span>{status.market_data_mode}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Connected</span>
            <span className={status.connected ? 'text-green-500' : 'text-destructive'}>
              {status.connected ? (
                <CheckCircle2 className="inline h-3.5 w-3.5" />
              ) : (
                <AlertCircle className="inline h-3.5 w-3.5" />
              )}
              {' '}{status.connection_state}
            </span>
          </div>
          {status.stale && (
            <p className="text-yellow-500 text-xs">Feed data is stale</p>
          )}
        </div>
      )}
    </div>
  );
}
