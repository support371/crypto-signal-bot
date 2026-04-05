import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface EarningsSummary {
  total_realized_pnl: number;
  trade_count: number;
  win_count: number;
  loss_count: number;
  win_rate_pct: number;
  avg_pnl_per_trade: number;
  best_trade_pnl: number;
  worst_trade_pnl: number;
  open_lots: number;
}

export interface TradeRecord {
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number | null;
  exit_price: number;
  realized_pnl: number;
  pnl_pct: number;
  intent_id: string;
  opened_at?: number;
  closed_at: number;
  note?: string;
}

interface EarningsState {
  summary: EarningsSummary | null;
  trades: TradeRecord[];
  isLoading: boolean;
}

export function useEarnings(pollIntervalMs = 15000) {
  const [state, setState] = useState<EarningsState>({
    summary: null,
    trades: [],
    isLoading: true,
  });

  const fetchEarnings = useCallback(async () => {
    try {
      const [summary, history] = await Promise.all([
        fetchBackendJson<EarningsSummary>('/earnings/summary'),
        fetchBackendJson<{ trades: TradeRecord[] }>('/earnings/history?limit=20'),
      ]);
      setState({ summary, trades: history.trades, isLoading: false });
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    fetchEarnings();
    const id = window.setInterval(fetchEarnings, pollIntervalMs);
    return () => clearInterval(id);
  }, [fetchEarnings, pollIntervalMs]);

  return { ...state, refetch: fetchEarnings };
}
