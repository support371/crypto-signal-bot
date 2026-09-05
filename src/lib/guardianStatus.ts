import type { GuardianStatus } from '../components/dashboard/GuardianPanel';

export type WorkerGuardianStatus = Partial<Omit<GuardianStatus, 'thresholds'>> & {
  reason?: string | null;
  error_count?: number;
  thresholds?: Partial<GuardianStatus['thresholds']>;
  max_api_errors?: number;
  max_failed_orders?: number;
  max_drawdown_pct?: number;
};

export function normalizeGuardianStatus(data: WorkerGuardianStatus): GuardianStatus {
  return {
    triggered: data.triggered ?? false,
    trigger_reason: data.trigger_reason ?? data.reason ?? null,
    trigger_ts: data.trigger_ts ?? null,
    kill_switch_active: data.kill_switch_active ?? false,
    kill_switch_reason: data.kill_switch_reason ?? null,
    drawdown_pct: data.drawdown_pct ?? 0,
    api_error_count: data.api_error_count ?? data.error_count ?? 0,
    failed_order_count: data.failed_order_count ?? 0,
    reconciliation_drift_count: data.reconciliation_drift_count ?? 0,
    reconciliation_drift_active: data.reconciliation_drift_active ?? false,
    reconciliation_drift_reason: data.reconciliation_drift_reason ?? null,
    strategy_kill_switches: data.strategy_kill_switches ?? [],
    venue_kill_switches: data.venue_kill_switches ?? [],
    thresholds: {
      max_api_errors: data.thresholds?.max_api_errors ?? data.max_api_errors ?? 10,
      max_failed_orders: data.thresholds?.max_failed_orders ?? data.max_failed_orders ?? 5,
      max_drawdown_pct: data.thresholds?.max_drawdown_pct ?? data.max_drawdown_pct ?? 15,
      reconciliation_drift_tolerance_cycles:
        data.thresholds?.reconciliation_drift_tolerance_cycles ?? 3,
    },
    market_data: data.market_data,
  };
}
