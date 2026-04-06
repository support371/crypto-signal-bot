import { useCallback, useEffect, useState } from 'react';
import { fetchBackendJson } from '@/lib/backend';

export interface AuditIntent {
  id: string;
  symbol: string;
  side: string;
  status: string;
  mode?: string;
  notes?: string | null;
  fill_price?: number | null;
  created_at?: number;
  updated_at?: number;
}

export interface AuditOrder {
  id: string;
  symbol: string;
  side: string;
  status: string;
  fill_price?: number | null;
  quantity?: number;
  updated_at?: number;
  created_at?: number;
}

export interface AuditWithdrawal {
  asset: string;
  amount: number;
  address?: string;
  timestamp: number;
}

export interface AuditRiskEvent {
  intent_id?: string;
  risk_score?: number;
  reason?: string;
  timestamp: number;
}

export interface AuditTrail {
  intents: AuditIntent[];
  orders: AuditOrder[];
  withdrawals: AuditWithdrawal[];
  risk_events: AuditRiskEvent[];
}

interface AuditTrailState {
  audit: AuditTrail | null;
  isLoading: boolean;
}

const EMPTY_AUDIT: AuditTrail = {
  intents: [],
  orders: [],
  withdrawals: [],
  risk_events: [],
};

export function useAuditTrail(pollIntervalMs = 15000) {
  const [state, setState] = useState<AuditTrailState>({
    audit: null,
    isLoading: true,
  });

  const fetchAudit = useCallback(async () => {
    try {
      const audit = await fetchBackendJson<AuditTrail>('/audit');
      setState({
        audit: {
          intents: audit.intents ?? [],
          orders: audit.orders ?? [],
          withdrawals: audit.withdrawals ?? [],
          risk_events: audit.risk_events ?? [],
        },
        isLoading: false,
      });
    } catch {
      setState((prev) => ({
        audit: prev.audit ?? EMPTY_AUDIT,
        isLoading: false,
      }));
    }
  }, []);

  useEffect(() => {
    fetchAudit();
    const id = window.setInterval(fetchAudit, pollIntervalMs);
    return () => window.clearInterval(id);
  }, [fetchAudit, pollIntervalMs]);

  return { ...state, refetch: fetchAudit };
}
