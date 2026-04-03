import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

interface BackendHealth {
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  api_error_count: number;
  failed_order_count: number;
  halted: boolean;
  mode: string;
  guardian_triggered: boolean;
}

interface BackendConfig {
  trading_mode: string;
  network: string;
  auth_enabled: boolean;
  rate_limit_rpm: number;
}

interface BalanceResponse {
  balances: Record<string, number>;
  positions: Record<string, number>;
}

export function useBackendStatus(pollIntervalMs = 30000) {
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [paperBalance, setPaperBalance] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [healthData, balanceData, configData] = await Promise.all([
        fetchBackendJson<BackendHealth>('/health'),
        fetchBackendJson<BalanceResponse>('/balance'),
        fetchBackendJson<BackendConfig>('/config'),
      ]);

      setHealth(healthData);
      setPaperBalance(balanceData?.balances?.USDT ?? 0);
      setConfig(configData);
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
    paperBalance,
    isConnected,
    isLoading,
    error,
    refetch: fetchStatus,
  };
}
