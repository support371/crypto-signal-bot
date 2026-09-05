import { describe, expect, it } from 'vitest';
import { normalizeGuardianStatus } from '../lib/guardianStatus';

describe('guardian status runtime contract', () => {
  it('normalizes the deployed flat Worker response for the dashboard', () => {
    const status = normalizeGuardianStatus({
      triggered: false,
      reason: null,
      error_count: 0,
      drawdown_pct: 0,
      max_drawdown_pct: 15,
      max_api_errors: 10,
      max_failed_orders: 5,
    });

    expect(status.trigger_reason).toBeNull();
    expect(status.api_error_count).toBe(0);
    expect(status.thresholds).toEqual({
      max_api_errors: 10,
      max_failed_orders: 5,
      max_drawdown_pct: 15,
      reconciliation_drift_tolerance_cycles: 3,
    });
  });

  it('preserves the nested dashboard contract when the Worker supplies it', () => {
    const status = normalizeGuardianStatus({
      triggered: true,
      trigger_reason: 'drawdown',
      thresholds: {
        max_api_errors: 8,
        max_failed_orders: 4,
        max_drawdown_pct: 12,
        reconciliation_drift_tolerance_cycles: 2,
      },
    });

    expect(status.triggered).toBe(true);
    expect(status.trigger_reason).toBe('drawdown');
    expect(status.thresholds.max_drawdown_pct).toBe(12);
  });
});
