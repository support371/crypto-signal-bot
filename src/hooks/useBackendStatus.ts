import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface BackendHealth {
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  api_error_count: number;
  failed_order_count: number;
  halted: boolean;
  mode: string;
  guardian_triggered: boolean;
  market_data_mode: string;
  market_data_connected: boolean;
  market_data_source: string;
}

export interface BackendConfig {
  trading_mode: string;
  network: string;
  adapter: string;
  auth_enabled: boolean;
  rate_limit_rpm: number;
  paper_use_live_market_data: boolean;
}

export interface BackendExchangeStatus {
  trading_mode: string;
  execution_mode: string;
  paper_use_live_market_data: boolean;
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

interface BalanceResponse {
  balances: Record<string, number>;
  positions: Record<string, number>;
}

export function useBackendStatus(pollIntervalMs = 30000) {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [exchangeStatus, setExchangeStatus] = useState<BackendExchangeStatus | null>(null);
  const [paperBalance, setPaperBalance] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [healthData, balanceData, configData, exchangeData] = await Promise.all([
        fetchBackendJson<BackendHealth>('/health'),
        fetchBackendJson<BalanceResponse>('/balance'),
        fetchBackendJson<BackendConfig>('/config'),
        fetchBackendJson<BackendExchangeStatus>('/exchange/status'),
      ]);

      setHealth(healthData);
      setPaperBalance(balanceData?.balances?.USDT ?? 0);
      setConfig(configData);
      setExchangeStatus(exchangeData);
      setIsConnected(true);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reach backend';
      setIsConnected(false);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = window.setInterval(fetchStatus, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [fetchStatus, pollIntervalMs]);

  return {
    health,
    config,
    exchangeStatus,
    paperBalance,
    isConnected,
    isLoading,
    error,
    refetch: fetchStatus,
  };
}
