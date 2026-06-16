import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface PortfolioBalance {
  balances?: Record<string, number>;
  positions?: Record<string, number>;
  balance_usdt?: number | string;
  free?: number | string;
  total?: number | string;
}

export interface BackendPosition {
  symbol?: string;
  quantity?: number | string;
  status?: string;
}

export interface PortfolioSummary {
  balance_usdt?: number | string;
  cash_usdt?: number | string;
  cash_balance?: number | string;
  positions?: BackendPosition[] | Record<string, number>;
  open_positions?: BackendPosition[];
}

export interface BackendOrder {
  id?: string | number;
  symbol?: string;
  side?: string;
  order_type?: string;
  quantity?: number | string;
  price?: number | string | null;
  status?: string;
  created_at?: number | string;
}

export interface PaperOrder {
  id: string;
  symbol: string;
  side: string;
  order_type: string;
  quantity: number;
  price: number | null;
  status: string;
  created_at: number;
}

export interface PortfolioState {
  balances: Record<string, number>;
  positions: Record<string, number>;
  orders: PaperOrder[];
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

function normalizeSymbol(symbol: unknown): string {
  return String(symbol ?? '')
    .toUpperCase()
    .replace(/[-/](USDT|USD)$/i, '')
    .replace(/(USDT|USD)$/i, '')
    .trim();
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  }
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : Math.floor(Date.now() / 1000);
}

function normalizePositions(input: PortfolioSummary['positions'] | BackendPosition[] | undefined): Record<string, number> {
  if (!input) return {};
  if (Array.isArray(input)) {
    return input.reduce<Record<string, number>>((acc, position) => {
      const symbol = normalizeSymbol(position.symbol);
      const quantity = numberOr(position.quantity);
      if (symbol && quantity > 0 && position.status !== 'closed') {
        acc[symbol] = (acc[symbol] ?? 0) + quantity;
      }
      return acc;
    }, {});
  }
  return Object.fromEntries(
    Object.entries(input)
      .map(([symbol, quantity]) => [normalizeSymbol(symbol), numberOr(quantity)] as const)
      .filter(([symbol, quantity]) => Boolean(symbol) && quantity > 0),
  );
}

function normalizeOrder(order: BackendOrder): PaperOrder {
  const side = String(order.side ?? '').toUpperCase();
  return {
    id: String(order.id ?? `${order.symbol ?? 'order'}-${order.created_at ?? Date.now()}`),
    symbol: normalizeSymbol(order.symbol) || String(order.symbol ?? 'UNKNOWN').toUpperCase(),
    side: side === 'SELL' ? 'SELL' : 'BUY',
    order_type: String(order.order_type ?? 'MARKET').toUpperCase(),
    quantity: numberOr(order.quantity),
    price: order.price === null || order.price === undefined ? null : numberOr(order.price),
    status: String(order.status ?? 'FILLED').toUpperCase(),
    created_at: normalizeTimestamp(order.created_at),
  };
}

export function usePortfolio(pollIntervalMs = 10000) {
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const [balData, ordData, summaryData] = await Promise.all([
        fetchBackendJson<PortfolioBalance>('/balance'),
        fetchBackendJson<{ orders?: BackendOrder[] }>('/orders'),
        fetchBackendJson<PortfolioSummary>('/api/v1/portfolio'),
      ]);

      const usdt = firstNumber(
        summaryData.cash_balance,
        summaryData.balance_usdt,
        summaryData.cash_usdt,
        balData.balances?.USDT,
        balData.balance_usdt,
        balData.free,
        balData.total,
      ) ?? 0;

      const positions = {
        ...normalizePositions(balData.positions),
        ...normalizePositions(summaryData.positions),
        ...normalizePositions(summaryData.open_positions),
      };

      setPortfolio({
        balances: { USDT: usdt, ...positions },
        positions,
        orders: (ordData.orders ?? []).map(normalizeOrder),
      });
    } catch {
      // Keep last known state on transient errors.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = window.setInterval(fetch, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [fetch, pollIntervalMs]);

  return { portfolio, isLoading, refetch: fetch };
}
