import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface PortfolioBalance {
  balances: Record<string, number>;
  positions: Record<string, number>;
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

export function usePortfolio(pollIntervalMs = 10000) {
  const [portfolio, setPortfolio] = useState<PortfolioState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const [balData, ordData] = await Promise.all([
        fetchBackendJson<PortfolioBalance>('/balance'),
        fetchBackendJson<{ orders: PaperOrder[] }>('/orders'),
      ]);
      setPortfolio({
        balances: balData.balances,
        positions: balData.positions,
        orders: ordData.orders,
      });
    } catch {
      // keep last known state on transient errors
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
