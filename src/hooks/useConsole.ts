// src/hooks/useConsole.ts
import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface ConsoleStatus {
  guardian: {
    kill_switch_active: boolean;
    triggered: boolean;
    drawdown_pct: number;
    daily_loss_pct: number;
    api_error_count: number;
    failed_order_count: number;
  };
  portfolio: {
    cash_balance: number;
    equity: number;
    drawdown_pct: number;
    trade_count: number;
    win_rate: number;
  };
  signals: {
    symbols: Array<{
      symbol: string;
      side: string;
      confidence: number;
      strategy_id: string;
    }>;
    overrides: Record<string, number>;
  };
  market: Record<string, unknown>;
  ts: number;
}

export interface TradeResult {
  order_id: string;
  status: string;
  fill_price: string | null;
  filled_qty: string | null;
  venue: string;
  signal_gate_bypassed: boolean;
  elapsed_ms: number;
}

export function useConsole(pollIntervalMs = 10_000) {
  const [status, setStatus] = useState<ConsoleStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await fetchBackendJson<ConsoleStatus>('/api/v1/console/status');
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Console fetch failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const submitTrade = useCallback(async (params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    force?: boolean;
    mode?: string;
  }): Promise<TradeResult> => {
    return fetchBackendJson<TradeResult>('/api/v1/console/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }, []);

  const toggleKillSwitch = useCallback(async (activate: boolean, reason?: string) => {
    await fetchBackendJson('/api/v1/console/kill-switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activate, reason: reason ?? (activate ? 'Manual operator action' : undefined) }),
    });
    await fetchStatus();
  }, [fetchStatus]);

  const setSignalOverride = useCallback(async (symbol: string, ttlSeconds = 300) => {
    return fetchBackendJson('/api/v1/console/signal-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, ttl_seconds: ttlSeconds }),
    });
  }, []);

  const cancelSignalOverride = useCallback(async (symbol: string) => {
    return fetchBackendJson(`/api/v1/console/signal-override/${symbol}`, {
      method: 'DELETE',
    });
  }, []);

  const reEvalSignals = useCallback(async (symbol?: string) => {
    return fetchBackendJson('/api/v1/console/signal-reeval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(symbol ? { symbol } : {}),
    });
  }, []);

  const resetGuardian = useCallback(async () => {
    return fetchBackendJson('/api/v1/console/guardian/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
  }, []);

  const resetPortfolio = useCallback(async (startingCash = 10000) => {
    return fetchBackendJson('/api/v1/console/portfolio/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, starting_cash: startingCash }),
    });
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = window.setInterval(fetchStatus, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [fetchStatus, pollIntervalMs]);

  return {
    status, isLoading, error,
    refetch: fetchStatus,
    submitTrade,
    toggleKillSwitch,
    setSignalOverride,
    cancelSignalOverride,
    reEvalSignals,
    resetGuardian,
    resetPortfolio,
  };
}
