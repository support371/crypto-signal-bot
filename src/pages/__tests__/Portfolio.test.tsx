import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/hooks/usePortfolio', () => ({
  usePortfolio: vi.fn(),
}));
vi.mock('@/lib/backend', () => ({
  fetchBackendJson: vi.fn().mockResolvedValue({}),
}));

import Portfolio from '../Portfolio';
import { usePortfolio } from '@/hooks/usePortfolio';

const mockPortfolio = {
  balances: { USDT: 8500 },
  positions: { BTC: 0.01, ETH: 0.5 },
  orders: [
    {
      id: 'ord-1',
      symbol: 'BTC',
      side: 'BUY',
      order_type: 'MARKET',
      quantity: 0.01,
      price: 97500,
      status: 'FILLED',
      created_at: 1732500000,
    },
    {
      id: 'ord-2',
      symbol: 'ETH',
      side: 'SELL',
      order_type: 'LIMIT',
      quantity: 0.5,
      price: 3500,
      status: 'REJECTED',
      created_at: 1732499000,
    },
  ],
};

beforeEach(() => {
  vi.mocked(usePortfolio).mockReturnValue({
    portfolio: mockPortfolio,
    isLoading: false,
    refetch: vi.fn(),
  } as any);
});

describe('Portfolio page', () => {
  it('renders the page title', () => {
    render(<Portfolio />);
    expect(screen.getByText('Portfolio')).toBeInTheDocument();
  });

  it('shows summary stat cards', () => {
    render(<Portfolio />);
    expect(screen.getByText('Total Equity')).toBeInTheDocument();
    expect(screen.getByText(/Cash/)).toBeInTheDocument();
  });

  it('shows open positions section', () => {
    render(<Portfolio />);
    expect(screen.getByText('Open Positions')).toBeInTheDocument();
  });

  it('shows recent orders section', () => {
    render(<Portfolio />);
    expect(screen.getByText('Recent Orders')).toBeInTheDocument();
  });

  it('renders paper mode footer', () => {
    render(<Portfolio />);
    expect(screen.getByText(/paper trading/i)).toBeInTheDocument();
  });

  it('shows order status badges', () => {
    render(<Portfolio />);
    expect(screen.getByText('FILLED')).toBeInTheDocument();
    expect(screen.getByText('REJECTED')).toBeInTheDocument();
  });

  it('shows BUY/SELL side indicators', () => {
    render(<Portfolio />);
    expect(screen.getByText('BUY')).toBeInTheDocument();
    expect(screen.getByText('SELL')).toBeInTheDocument();
  });

  it('shows empty state when no positions', () => {
    vi.mocked(usePortfolio).mockReturnValue({
      portfolio: { balances: { USDT: 10000 }, positions: {}, orders: [] },
      isLoading: false,
      refetch: vi.fn(),
    } as any);
    render(<Portfolio />);
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument();
  });

  it('shows empty state when portfolio is null', () => {
    vi.mocked(usePortfolio).mockReturnValue({
      portfolio: null,
      isLoading: false,
      refetch: vi.fn(),
    } as any);
    render(<Portfolio />);
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument();
  });
});
