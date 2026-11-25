import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useBackendStatus', () => ({
  useBackendStatus: vi.fn(),
}));
vi.mock('@/hooks/useMonitoring', () => ({
  useMonitoring: vi.fn(),
}));
vi.mock('@/hooks/useGuardianStatus', () => ({
  useGuardianStatus: vi.fn(),
}));
vi.mock('@/hooks/useExchangeStatus', () => ({
  useExchangeStatus: vi.fn(),
}));

import Health from '../Health';
import { useBackendStatus } from '@/hooks/useBackendStatus';
import { useMonitoring } from '@/hooks/useMonitoring';
import { useGuardianStatus } from '@/hooks/useGuardianStatus';
import { useExchangeStatus } from '@/hooks/useExchangeStatus';

const mockHealth = {
  status: 'ok',
  service: 'crypto-signal-bot',
  runtime: 'python-3.11',
  mode: 'paper',
  network: 'testnet',
  uptime_seconds: 3661,
};

const mockGuardian = {
  triggered: false,
  kill_switch_active: false,
  kill_switch_reason: null,
  drawdown_pct: 0.02,
  api_error_count: 0,
  failed_order_count: 0,
};

const mockExchange = {
  connected: true,
  connection_state: 'connected',
  source: 'coingecko',
  market_data_mode: 'live',
  stale: false,
  fallback_active: false,
  symbols: ['BTCUSDT', 'ETHUSDT'],
  last_error: null,
};

const mockMonitor = {
  overall_ok: true,
  run_count: 42,
  probe_interval: 60,
  probes: {
    health: { ok: true, latency_ms: 12, consecutive_failures: 0 },
    market_data: { ok: true, latency_ms: 45, consecutive_failures: 0 },
  },
};

beforeEach(() => {
  vi.mocked(useBackendStatus).mockReturnValue({
    health: mockHealth,
    isLoading: false,
    isLive: true,
    refetch: vi.fn(),
  } as any);
  vi.mocked(useMonitoring).mockReturnValue({
    status: mockMonitor,
    isLoading: false,
    runNow: vi.fn(),
  } as any);
  vi.mocked(useGuardianStatus).mockReturnValue({
    guardian: mockGuardian,
  } as any);
  vi.mocked(useExchangeStatus).mockReturnValue({
    status: mockExchange,
  } as any);
});

describe('Health page', () => {
  it('renders the page title', () => {
    render(<Health />);
    expect(screen.getByText('System Health')).toBeInTheDocument();
  });

  it('shows all systems operational when health is ok', () => {
    render(<Health />);
    expect(screen.getByText('All Systems Operational')).toBeInTheDocument();
  });

  it('shows degraded when health status is not ok', () => {
    vi.mocked(useBackendStatus).mockReturnValue({
      health: { ...mockHealth, status: 'degraded' },
      isLoading: false,
      isLive: true,
      refetch: vi.fn(),
    } as any);
    render(<Health />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });

  it('renders backend service details', () => {
    render(<Health />);
    expect(screen.getByText('Backend Service')).toBeInTheDocument();
    expect(screen.getByText('crypto-signal-bot')).toBeInTheDocument();
    expect(screen.getByText('python-3.11')).toBeInTheDocument();
  });

  it('renders guardian section', () => {
    render(<Health />);
    expect(screen.getByText('Guardian')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('shows kill switch active when guardian triggered', () => {
    vi.mocked(useGuardianStatus).mockReturnValue({
      guardian: { ...mockGuardian, kill_switch_active: true },
    } as any);
    render(<Health />);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('renders market data section', () => {
    render(<Health />);
    expect(screen.getByText('Market Data')).toBeInTheDocument();
    expect(screen.getByText('coingecko')).toBeInTheDocument();
    expect(screen.getByText('BTCUSDT, ETHUSDT')).toBeInTheDocument();
  });

  it('renders monitoring probes', () => {
    render(<Health />);
    expect(screen.getByText('Monitoring Probes')).toBeInTheDocument();
    expect(screen.getByText('health')).toBeInTheDocument();
    expect(screen.getByText('market_data')).toBeInTheDocument();
    expect(screen.getByText('12ms')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    vi.mocked(useBackendStatus).mockReturnValue({
      health: null,
      isLoading: true,
      isLive: false,
      refetch: vi.fn(),
    } as any);
    render(<Health />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows backend unreachable when health is null', () => {
    vi.mocked(useBackendStatus).mockReturnValue({
      health: null,
      isLoading: false,
      isLive: false,
      refetch: vi.fn(),
    } as any);
    render(<Health />);
    expect(screen.getByText('Backend unreachable')).toBeInTheDocument();
  });

  it('renders paper mode footer', () => {
    render(<Health />);
    expect(screen.getByText(/PAPER MODE/)).toBeInTheDocument();
  });

  it('formats uptime correctly', () => {
    render(<Health />);
    expect(screen.getByText('1h 1m 1s')).toBeInTheDocument();
  });
});
