import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson, getBackendBaseUrl } from '@/lib/backend';

/**
 * BackendHealth represents the health response from /health.
 * The backend may return a minimal payload, so most fields are optional.
 */
export interface BackendHealth {
  status?: string;
  service?: string;
  runtime?: string;
  mode?: string;
  network?: string;
  uptime_seconds?: number;
  // Extended fields (may not be present in minimal response)
  kill_switch_active?: boolean;
  kill_switch_reason?: string | null;
  api_error_count?: number;
  failed_order_count?: number;
  halted?: boolean;
  guardian_triggered?: boolean;
  market_data_mode?: string;
  market_data_connected?: boolean;
  market_data_source?: string;
}

/**
 * Normalized BackendHealth with safe defaults for dashboard display.
 */
export interface NormalizedBackendHealth {
  status: string;
  service: string;
  runtime: string;
  mode: string;
  network: string;
  uptime_seconds: number;
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
  api_error_count: number;
  failed_order_count: number;
  halted: boolean;
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

export interface EndpointErrors {
  healthError: string | null;
  balanceError: string | null;
  configError: string | null;
  exchangeStatusError: string | null;
}

export interface UseBackendStatusResult {
  health: NormalizedBackendHealth | null;
  config: BackendConfig | null;
  exchangeStatus: BackendExchangeStatus | null;
  paperBalance: number | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  endpointErrors: EndpointErrors;
  lastSuccessfulHealthAt: Date | null;
  backendUrl: string;
  refetch: () => Promise<void>;
}

/**
 * Normalize a raw /health response into a consistent shape with safe defaults.
 */
function normalizeHealth(raw: BackendHealth): NormalizedBackendHealth {
  return {
    status: raw.status ?? 'unknown',
    service: raw.service ?? 'crypto-signal-bot-backend',
    runtime: raw.runtime ?? 'unknown',
    mode: raw.mode ?? 'paper',
    network: raw.network ?? 'testnet',
    uptime_seconds: raw.uptime_seconds ?? 0,
    kill_switch_active: raw.kill_switch_active ?? false,
    kill_switch_reason: raw.kill_switch_reason ?? null,
    api_error_count: raw.api_error_count ?? 0,
    failed_order_count: raw.failed_order_count ?? 0,
    halted: raw.halted ?? false,
    guardian_triggered: raw.guardian_triggered ?? false,
    market_data_mode: raw.market_data_mode ?? 'paper',
    market_data_connected: raw.market_data_connected ?? false,
    market_data_source: raw.market_data_source ?? 'health',
  };
}

/**
 * useBackendStatus hook with resilient endpoint handling.
 *
 * Rules:
 * - /health is the source of truth for backend connectivity.
 * - If /health succeeds, isConnected = true.
 * - /balance, /config, /exchange/status are optional diagnostics.
 * - If an optional endpoint fails, keep previous value or set safe default,
 *   but do NOT mark the whole backend offline.
 * - Exposes per-endpoint errors for diagnostics.
 */
export function useBackendStatus(pollIntervalMs = 30000): UseBackendStatusResult {
  const [health, setHealth] = useState<NormalizedBackendHealth | null>(null);
  const [config, setConfig] = useState<BackendConfig | null>(null);
  const [exchangeStatus, setExchangeStatus] = useState<BackendExchangeStatus | null>(null);
  const [paperBalance, setPaperBalance] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccessfulHealthAt, setLastSuccessfulHealthAt] = useState<Date | null>(null);
  const [endpointErrors, setEndpointErrors] = useState<EndpointErrors>({
    healthError: null,
    balanceError: null,
    configError: null,
    exchangeStatusError: null,
  });

  const backendUrl = getBackendBaseUrl();

  const fetchStatus = useCallback(async () => {
    const newErrors: EndpointErrors = {
      healthError: null,
      balanceError: null,
      configError: null,
      exchangeStatusError: null,
    };

    // Use Promise.allSettled for resilient fetching
    const [healthResult, balanceResult, configResult, exchangeResult] = await Promise.allSettled([
      fetchBackendJson<BackendHealth>('/health'),
      fetchBackendJson<BalanceResponse>('/balance'),
      fetchBackendJson<BackendConfig>('/config'),
      fetchBackendJson<BackendExchangeStatus>('/exchange/status'),
    ]);

    // /health is the source of truth for connectivity
    if (healthResult.status === 'fulfilled') {
      const normalized = normalizeHealth(healthResult.value);
      setHealth(normalized);
      setIsConnected(true);
      setError(null);
      setLastSuccessfulHealthAt(new Date());
    } else {
      const healthErr = healthResult.reason instanceof Error
        ? healthResult.reason.message
        : 'Failed to reach backend';
      newErrors.healthError = healthErr;
      setIsConnected(false);
      setError(healthErr);
      // Don't clear health data - keep last known state for reference
    }

    // /balance - optional, keep previous value on failure
    if (balanceResult.status === 'fulfilled') {
      setPaperBalance(balanceResult.value?.balances?.USDT ?? 0);
    } else {
      const balErr = balanceResult.reason instanceof Error
        ? balanceResult.reason.message
        : 'Failed to fetch balance';
      newErrors.balanceError = balErr;
      // Keep previous paperBalance value
    }

    // /config - optional, keep previous value on failure
    if (configResult.status === 'fulfilled') {
      setConfig(configResult.value);
    } else {
      const configErr = configResult.reason instanceof Error
        ? configResult.reason.message
        : 'Failed to fetch config';
      newErrors.configError = configErr;
      // Keep previous config value
    }

    // /exchange/status - optional, keep previous value on failure
    if (exchangeResult.status === 'fulfilled') {
      setExchangeStatus(exchangeResult.value);
    } else {
      const exchErr = exchangeResult.reason instanceof Error
        ? exchangeResult.reason.message
        : 'Failed to fetch exchange status';
      newErrors.exchangeStatusError = exchErr;
      // Keep previous exchangeStatus value
    }

    setEndpointErrors(newErrors);
    setIsLoading(false);
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
    endpointErrors,
    lastSuccessfulHealthAt,
    backendUrl,
    refetch: fetchStatus,
  };
}
