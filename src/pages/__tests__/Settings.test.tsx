import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/useGuardianStatus', () => ({
  useGuardianStatus: vi.fn(),
}));
vi.mock('@/hooks/useExchangeStatus', () => ({
  useExchangeStatus: vi.fn(),
}));
vi.mock('@/hooks/usePersistedSettings', () => ({
  usePersistedSettings: vi.fn(),
}));
vi.mock('@/lib/backend', () => ({
  fetchBackendJson: vi.fn(),
}));

import Settings from '../Settings';
import { useGuardianStatus } from '@/hooks/useGuardianStatus';
import { useExchangeStatus } from '@/hooks/useExchangeStatus';
import { usePersistedSettings } from '@/hooks/usePersistedSettings';

const mockGuardian = {
  triggered: false,
  kill_switch_active: false,
  kill_switch_reason: null,
  drawdown_pct: 0.01,
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

const mockSettings = {
  riskTolerance: 0.5,
  volatilitySensitivity: 0.5,
  positionSizeFraction: 0.1,
  spreadStressThreshold: 0.5,
  enableSoundAlerts: false,
  enableAutoTrade: false,
};

beforeEach(() => {
  vi.mocked(useGuardianStatus).mockReturnValue({
    guardian: mockGuardian,
  } as any);
  vi.mocked(useExchangeStatus).mockReturnValue({
    status: mockExchange,
  } as any);
  vi.mocked(usePersistedSettings).mockReturnValue({
    settings: mockSettings,
    updateSetting: vi.fn(),
    resetSettings: vi.fn(),
  } as any);
});

describe('Settings page', () => {
  it('renders the page title', () => {
    render(<Settings />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders paper mode note', () => {
    render(<Settings />);
    expect(screen.getByText(/paper-mode/i)).toBeInTheDocument();
  });

  it('renders system status section', () => {
    render(<Settings />);
    expect(screen.getByText('System Status')).toBeInTheDocument();
  });

  it('renders guardian status section', () => {
    render(<Settings />);
    expect(screen.getByText('Guardian Status')).toBeInTheDocument();
  });

  it('renders market data section', () => {
    render(<Settings />);
    expect(screen.getByText('Market Data')).toBeInTheDocument();
  });

  it('renders dashboard preferences section', () => {
    render(<Settings />);
    expect(screen.getByText('Dashboard Preferences')).toBeInTheDocument();
  });

  it('shows guardian kill switch inactive', () => {
    render(<Settings />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('shows market data connected', () => {
    render(<Settings />);
    expect(screen.getByText('connected')).toBeInTheDocument();
  });
});
