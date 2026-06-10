/**
 * src/hooks/useExchangeStatus.ts
 *
 * Polls /exchange/status and /market/feed/status for live exchange connectivity state.
 */
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "@/lib/apiClient";

export interface ExchangeStatus {
  trading_mode: string;
  execution_mode: string;
  exchange: string | null;
  market_data_mode: string;
  connected: boolean;
  connection_state: string;
  fallback_active: boolean;
  last_update_ts: number | null;
  last_error: string | null;
  stale: boolean;
  symbols: string[];
  source: string;
}

export interface FeedStatus {
  source: string;
  symbol_count: number;
  connected: boolean;
  stale: boolean;
  last_tick_at: number | null;
  latency_ms: number | null;
  fallback_active: boolean;
}

export interface UseExchangeStatusResult {
  exchangeStatus: ExchangeStatus | null;
  feedStatus: FeedStatus | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useExchangeStatus(pollMs = 15_000): UseExchangeStatusResult {
  const [exchangeStatus, setExchangeStatus] = useState<ExchangeStatus | null>(null);
  const [feedStatus, setFeedStatus] = useState<FeedStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      const [ex, feed] = await Promise.all([
        apiGet<ExchangeStatus>("/exchange/status"),
        apiGet<FeedStatus>("/market/feed/status"),
      ]);
      setExchangeStatus(ex);
      setFeedStatus(feed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch exchange status");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, pollMs);
    return () => clearInterval(id);
  }, [fetch, pollMs]);

  return { exchangeStatus, feedStatus, isLoading, error, refetch: fetch };
}
