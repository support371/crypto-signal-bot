/**
 * src/hooks/useBackendState.ts
 *
 * PHASE 13 — Consolidated backend state consumer.
 *
 * Replaces every remaining client-side truth source:
 *   - Balance truth          → GET /balance
 *   - Position truth         → GET /balance (positions field)
 *   - Order truth            → GET /orders
 *   - Guardian/kill-switch   → GET /guardian/status
 *   - Reconciliation state   → backend /earnings/summary
 *   - Exchange health        → GET /exchange/status
 *
 * No fabricated values. No demo state. No in-memory fallbacks.
 * When the backend is unreachable: explicit loading/unavailable state only.
 *
 * Rule: frontend is a consumer only.
 */

import { useCallback, useEffect, useState } from "react";
import { apiFetch, BackendConfigError, BackendUnavailableError } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types — match backend Phase 9/10/11 response shapes
// ---------------------------------------------------------------------------

export interface BalanceState {
  balances: Record<string, number>;
  positions: PositionState[];
}

export interface PositionState {
  symbol:          string;
  side:            "LONG" | "SHORT";
  quantity:        number;
  entry_price:     number;
  mark_price:      number;
  unrealized_pnl:  number;
}

export interface OrderState {
  id:          string;
  symbol:      string;
  side:        "BUY" | "SELL";
  order_type:  string;
  quantity:    number;
  status:      string;
  fill_price:  number | null;
  created_at:  number;
}

export interface GuardianState {
  kill_switch_active:  boolean;
  triggered:           boolean;
  kill_switch_reason:  string | null;
  trigger_reason:      string | null;
  drawdown_pct:        number;
  api_error_count:     number;
  failed_order_count:  number;
  thresholds: {
    max_drawdown_pct:  number;
    max_api_errors:    number;
    max_failed_orders: number;
  };
  market_data:         Record<string, unknown> | null;
  last_heartbeat_at:   number | null;
  heartbeat_healthy:   boolean;
  computed_at:         number;
}

export interface ExchangeHealthState {
  connected:            boolean;
  mode:                 string;
  exchange_name:        string;
  market_data_mode:     string;   // "live" | "paper_live" | "unavailable" — never "SYNTHETIC"
  connection_state:     string;
  fallback_active:      false;    // always false post-Phase 6
  stale:                boolean;
  source:               string | null;
  error:                string | null;
}

export interface HealthState {
  mode:               string;    // "paper" | "live"
  kill_switch_active: boolean;
  kill_switch_reason: string | null;
}

export interface BackendStateResult {
  health:          HealthState | null;
  balance:         BalanceState | null;
  orders:          OrderState[];
  guardian:        GuardianState | null;
  exchangeHealth:  ExchangeHealthState | null;
  paperBalance:    number | null;   // USDT balance shortcut for header
  isConnected:     boolean;
  isLoading:       boolean;
  error:           string | null;
  refetch:         () => void;
}

const POLL_INTERVAL_MS = 30_000;

export function useBackendState(): BackendStateResult {
  const [health,         setHealth]        = useState<HealthState | null>(null);
  const [balance,        setBalance]       = useState<BalanceState | null>(null);
  const [orders,         setOrders]        = useState<OrderState[]>([]);
  const [guardian,       setGuardian]      = useState<GuardianState | null>(null);
  const [exchangeHealth, setExchangeHealth] = useState<ExchangeHealthState | null>(null);
  const [isConnected,    setIsConnected]   = useState(false);
  const [isLoading,      setIsLoading]     = useState(true);
  const [error,          setError]         = useState<string | null>(null);

  const fetch = useCallback(async () => {
    try {
      setError(null);
      const [h, b, o, g, ex] = await Promise.all([
        apiFetch<HealthState>("/health"),
        apiFetch<BalanceState>("/balance"),
        apiFetch<{ orders: OrderState[] }>("/orders").then(r => r.orders),
        apiFetch<GuardianState>("/guardian/status"),
        apiFetch<ExchangeHealthState>("/exchange/status"),
      ]);
      setHealth(h);
      setBalance(b);
      setOrders(o);
      setGuardian(g);
      setExchangeHealth(ex);
      setIsConnected(true);
    } catch (err) {
      if (err instanceof BackendConfigError) {
        setError("Backend not configured: " + err.message);
      } else if (err instanceof BackendUnavailableError) {
        setError("Backend unavailable.");
      } else {
        setError("Backend fetch failed.");
      }
      setIsConnected(false);
      // Do NOT inject fabricated state. Leave existing values intact on transient error.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetch]);

  const paperBalance = balance?.balances?.["USDT"] ?? null;

  return {
    health,
    balance,
    orders,
    guardian,
    exchangeHealth,
    paperBalance,
    isConnected,
    isLoading,
    error,
    refetch: fetch,
  };
}
