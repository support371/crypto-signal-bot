import { useCallback, useEffect, useState } from 'react';
import { fetchBackendText } from '@/lib/backend';

export interface BackendMetricsSnapshot {
  available: boolean;
  ordersTotal: number;
  buyOrders: number;
  sellOrders: number;
  riskBlocksTotal: number;
  killSwitchTriggers: number;
  apiErrorsTotal: number;
  pnlRealized: number;
  pnlUnrealized: number;
}

const EMPTY_METRICS: BackendMetricsSnapshot = {
  available: false,
  ordersTotal: 0,
  buyOrders: 0,
  sellOrders: 0,
  riskBlocksTotal: 0,
  killSwitchTriggers: 0,
  apiErrorsTotal: 0,
  pnlRealized: 0,
  pnlUnrealized: 0,
};

function parsePrometheusMetrics(payload: string): BackendMetricsSnapshot {
  const snapshot = { ...EMPTY_METRICS, available: true };

  for (const rawLine of payload.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)$/);
    if (!match) continue;

    const [, name, , rawLabels = '', rawValue] = match;
    const value = Number(rawValue);
    if (Number.isNaN(value)) continue;

    const labels = Object.fromEntries(
      rawLabels
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [key, quotedValue = ''] = entry.split('=');
          return [key, quotedValue.replace(/^"|"$/g, '')];
        })
    );

    switch (name) {
      case 'orders_total':
        snapshot.ordersTotal += value;
        if (labels.side === 'BUY') snapshot.buyOrders += value;
        if (labels.side === 'SELL') snapshot.sellOrders += value;
        break;
      case 'risk_blocks_total':
        snapshot.riskBlocksTotal = value;
        break;
      case 'kill_switch_triggers':
        snapshot.killSwitchTriggers = value;
        break;
      case 'api_errors_total':
        snapshot.apiErrorsTotal = value;
        break;
      case 'pnl_realized':
        snapshot.pnlRealized = value;
        break;
      case 'pnl_unrealized':
        snapshot.pnlUnrealized = value;
        break;
    }
  }

  return snapshot;
}

export function useBackendMetrics(pollIntervalMs = 30000) {
  const [metrics, setMetrics] = useState<BackendMetricsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      const payload = await fetchBackendText('/metrics');
      const trimmedPayload = payload.trim();

      if (!trimmedPayload) {
        setMetrics(EMPTY_METRICS);
        setError(null);
        return;
      }

      if (trimmedPayload.startsWith('{')) {
        const fallback = JSON.parse(trimmedPayload) as { message?: string };
        setMetrics({ ...EMPTY_METRICS, available: false });
        setError(fallback.message || 'Metrics unavailable');
        return;
      }

      setMetrics(parsePrometheusMetrics(trimmedPayload));
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch backend metrics';
      setMetrics({ ...EMPTY_METRICS, available: false });
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
    const interval = window.setInterval(fetchMetrics, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [fetchMetrics, pollIntervalMs]);

  return {
    metrics,
    isLoading,
    error,
    refetch: fetchMetrics,
  };
}
