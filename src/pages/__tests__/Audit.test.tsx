import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useAuditTrail', () => ({
  useAuditTrail: vi.fn(),
}));

import Audit from '../Audit';
import { useAuditTrail } from '@/hooks/useAuditTrail';

const mockAudit = {
  intents: [
    {
      id: 'intent-abc12345-6789',
      symbol: 'BTCUSDT',
      side: 'BUY',
      status: 'FILLED',
      mode: 'paper',
      fill_price: 97500.5,
      created_at: 1732500000,
    },
    {
      id: 'intent-def12345-6789',
      symbol: 'ETHUSDT',
      side: 'SELL',
      status: 'REJECTED',
      mode: 'paper',
      fill_price: null,
      created_at: 1732499000,
    },
  ],
  orders: [
    {
      id: 'order-abc12345-6789',
      symbol: 'BTCUSDT',
      side: 'BUY',
      status: 'FILLED',
      quantity: 0.001,
      fill_price: 97500.5,
      created_at: 1732500000,
    },
  ],
  risk_events: [
    {
      intent_id: 'intent-abc12345-6789',
      risk_score: 0.85,
      reason: 'High volatility detected',
      timestamp: 1732500000,
    },
    {
      intent_id: 'intent-def12345-6789',
      risk_score: 0.3,
      reason: 'Normal conditions',
      timestamp: 1732499000,
    },
  ],
  withdrawals: [],
};

beforeEach(() => {
  vi.mocked(useAuditTrail).mockReturnValue({
    audit: mockAudit,
    isLoading: false,
    refetch: vi.fn(),
  } as any);
});

describe('Audit page', () => {
  it('renders the page title', () => {
    render(<Audit />);
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
  });

  it('shows tab bar with counts', () => {
    render(<Audit />);
    expect(screen.getByText('Intents')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Risk Events')).toBeInTheDocument();
    expect(screen.getAllByText('(2)').length).toBeGreaterThanOrEqual(1);
  });

  it('shows intents tab by default', () => {
    render(<Audit />);
    expect(screen.getByText('BTCUSDT')).toBeInTheDocument();
    expect(screen.getByText('ETHUSDT')).toBeInTheDocument();
    expect(screen.getByText('FILLED')).toBeInTheDocument();
    expect(screen.getByText('REJECTED')).toBeInTheDocument();
  });

  it('shows BUY and SELL side indicators', () => {
    render(<Audit />);
    expect(screen.getByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('SELL')).toBeInTheDocument();
  });

  it('switches to orders tab', () => {
    render(<Audit />);
    fireEvent.click(screen.getByText('Orders'));
    expect(screen.getByText('order-ab...')).toBeInTheDocument();
  });

  it('switches to risk events tab', () => {
    render(<Audit />);
    fireEvent.click(screen.getByText('Risk Events'));
    expect(screen.getByText('High volatility detected')).toBeInTheDocument();
    expect(screen.getByText('Normal conditions')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    vi.mocked(useAuditTrail).mockReturnValue({
      audit: null,
      isLoading: true,
      refetch: vi.fn(),
    } as any);
    render(<Audit />);
    expect(screen.getByText('Loading audit trail...')).toBeInTheDocument();
  });

  it('shows empty state for intents', () => {
    vi.mocked(useAuditTrail).mockReturnValue({
      audit: { intents: [], orders: [], risk_events: [], withdrawals: [] },
      isLoading: false,
      refetch: vi.fn(),
    } as any);
    render(<Audit />);
    expect(screen.getByText('No execution intents recorded yet')).toBeInTheDocument();
  });

  it('shows empty state for orders tab', () => {
    vi.mocked(useAuditTrail).mockReturnValue({
      audit: { intents: [], orders: [], risk_events: [], withdrawals: [] },
      isLoading: false,
      refetch: vi.fn(),
    } as any);
    render(<Audit />);
    fireEvent.click(screen.getByText('Orders'));
    expect(screen.getByText('No orders recorded yet')).toBeInTheDocument();
  });

  it('shows empty state for risk events tab', () => {
    vi.mocked(useAuditTrail).mockReturnValue({
      audit: { intents: [], orders: [], risk_events: [], withdrawals: [] },
      isLoading: false,
      refetch: vi.fn(),
    } as any);
    render(<Audit />);
    fireEvent.click(screen.getByText('Risk Events'));
    expect(screen.getByText('No risk events recorded yet')).toBeInTheDocument();
  });

  it('renders paper mode footer', () => {
    render(<Audit />);
    expect(screen.getByText(/PAPER MODE/)).toBeInTheDocument();
  });

  it('calls refetch when refresh button clicked', () => {
    const refetch = vi.fn();
    vi.mocked(useAuditTrail).mockReturnValue({
      audit: mockAudit,
      isLoading: false,
      refetch,
    } as any);
    render(<Audit />);
    fireEvent.click(screen.getByText('Refresh'));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('formats fill price with dollar sign', () => {
    render(<Audit />);
    expect(screen.getByText('$97,500.50')).toBeInTheDocument();
  });
});
