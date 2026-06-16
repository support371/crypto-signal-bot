import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson, getBackendBaseUrl } from '@/lib/backend';

export interface BackendHealth {
  status?: string;
  service?: string;
  runtime?: string;
  mode?: string;
  trading_mode?: string;
  network?: string;
  uptime_seconds?: number;
  kill_switch_active?: boolean;
  kill_switch_reason?: string | null;
  api_error_count?: number;
  failed_order_count?: number;
  halted?: boolean;
  guardian_triggered?: boolean;
  triggered?: boolean;
  reason?: string | null;
  market_data_mode?: string;
  market_data_connected?: boolean;
  market_data_source?: string;
}

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
  balances?: Record<string, number>;
  positions?: Record<string, number>;
  balance_usdt?: number | string;
  free?: number | string;
  total?: number | string;
}

interface PortfolioSummaryResponse {
  cash_balance?: number | string;
  balance_usdt?: number | string;
  cash_usdt?: number | string;
  equity?: number | string;
  equity_usdt?: number | string;
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

function numberOr(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeHealth(raw: BackendHealth): NormalizedBackendHealth {
  const triggered = raw.kill_switch_active ?? raw.guardian_triggered ?? raw.triggered ?? false;
  return {
    status: raw.status ?? 'unknown',
    service: raw.service ?? 'crypto-signal-bot-backend',
    runtime: raw.runtime ?? 'cloudflare-workers',
    mode: raw.mode ?? raw.trading_mode ?? 'paper',
    network: raw.network ?? 'testnet',
    uptime_seconds: raw.uptime_seconds ?? 0,
    kill_switch_active: Boolean(triggered),
    kill_switch_reason: raw.kill_switch_reason ?? raw.reason ?? null,
    api_error_count: raw.api_error_count ?? 0,
    failed_order_count: raw.failed_order_count ?? 0,
    halted: raw.halted ?? Boolean(triggered),
    guardian_triggered: raw.guardian_triggered ?? Boolean(triggered),
    market_data_mode: raw.market_data_mode ?? 'live_public_paper',
    market_data_connected: raw.market_data_connected ?? true,
    market_data_source: raw.market_data_source ?? 'coinbase',
  };
}

function normalizeConfig(raw: Partial<BackendConfig> & Record<string, unknown>): BackendConfig {
  return {
    trading_mode: String(raw.trading_mode ?? raw.mode ?? 'paper'),
    network: String(raw.network ?? 'testnet'),
    adapter: String(raw.adapter ?? raw.market_data_source ?? 'coinbase_public'),
    auth_enabled: Boolean(raw.auth_enabled ?? false),
    rate_limit_rpm: numberOr(raw.rate_limit_rpm, 60),
    paper_use_live_market_data: Boolean(raw.paper_use_live_market_data ?? raw.market_data_source ?? true),
  };
}

function normalizeExchangeStatus(raw: Partial<BackendExchangeStatus> & Record<string, unknown>): BackendExchangeStatus {
  const status = String(raw.status ?? '').toLowerCase();
  const connected = Boolean(raw.connected ?? raw.public_market_data ?? status.includes('paper') ?? true);
  return {
    trading_mode: String(raw.trading_mode ?? raw.mode ?? 'paper'),
    execution_mode: String(raw.execution_mode ?? 'paper'),
    paper_use_live_market_data: Boolean(raw.paper_use_live_market_data ?? raw.public_market_data ?? true),
    exchange: typeof raw.exchange === 'string' ? raw.exchange : 'coinbase_public',
    market_data_mode: String(raw.market_data_mode ?? 'live_public_paper'),
    connected,
    connection_state: String(raw.connection_state ?? (connected ? 'connected' : 'degraded')),
    fallback_active: Boolean(raw.fallback_active ?? false),
    last_update_ts: firstNumber(raw.last_update_ts) ?? Date.now(),
    last_error: typeof raw.last_error === 'string' ? raw.last_error : null,
    stale: Boolean(raw.stale ?? false),
    symbols: Array.isArray(raw.symbols) ? raw.symbols.map(String) : ['BTC', 'ETH', 'SOL', 'BNB'],
    source: String(raw.source ?? raw.public_market_data ?? 'coinbase'),
  };
}

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

    const [healthResult, balanceResult, configResult, exchangeResult, portfolioResult] = await Promise.allSettled([
      fetchBackendJson<BackendHealth>('/health'),
      fetchBackendJson<BalanceResponse>('/balance'),
      fetchBackendJson<Record<string, unknown>>('/config'),
      fetchBackendJson<Record<string, unknown>>('/exchange/status'),
      fetchBackendJson<PortfolioSummaryResponse>('/api/v1/portfolio'),
    ]);

    if (healthResult.status === 'fulfilled') {
      const normalized = normalizeHealth(healthResult.value);
      setHealth(normalized);
      setIsConnected(normalized.status === 'ok' || normalized.status === 'healthy' || normalized.status === 'unknown');
      setError(null);
      setLastSuccessfulHealthAt(new Date());
    } else {
      const healthErr = healthResult.reason instanceof Error
        ? healthResult.reason.message
        : 'Failed to reach backend';
      newErrors.healthError = healthErr;
      setIsConnected(false);
      setError(healthErr);
    }

    if (portfolioResult.status === 'fulfilled') {
      const balance = firstNumber(
        portfolioResult.value.cash_balance,
        portfolioResult.value.balance_usdt,
        portfolioResult.value.cash_usdt,
        portfolioResult.value.equity,
        portfolioResult.value.equity_usdt,
      );
      if (balance !== null) setPaperBalance(balance);
    } else if (balanceResult.status === 'fulfilled') {
      const rawUsdt = firstNumber(
        balanceResult.value?.balances?.USDT,
        balanceResult.value?.balance_usdt,
        balanceResult.value?.free,
        balanceResult.value?.total,
      );
      if (rawUsdt !== null) setPaperBalance(rawUsdt);
    } else {
      const balErr = balanceResult.reason instanceof Error
        ? balanceResult.reason.message
        : 'Failed to fetch balance';
      newErrors.balanceError = balErr;
    }

    if (configResult.status === 'fulfilled') {
      setConfig(normalizeConfig(configResult.value));
    } else {
      const configErr = configResult.reason instanceof Error
        ? configResult.reason.message
        : 'Failed to fetch config';
      newErrors.configError = configErr;
    }

    if (exchangeResult.status === 'fulfilled') {
      setExchangeStatus(normalizeExchangeStatus(exchangeResult.value));
    } else {
      const exchErr = exchangeResult.reason instanceof Error
        ? exchangeResult.reason.message
        : 'Failed to fetch exchange status';
      newErrors.exchangeStatusError = exchErr;
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
