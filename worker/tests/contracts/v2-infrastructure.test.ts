import { describe, expect, it } from 'vitest'
import { DecisionMetricsStore } from '../../src/routes/v2-metrics'
import { buildV2InfrastructureStatus } from '../../src/routes/v2-infrastructure'
import { buildV2MarketFeedsStatus } from '../../src/routes/v2-market-feeds'

describe('v2 infrastructure contracts', () => {
  it('does not fabricate active feed health when no gateway is running', () => {
    const result = buildV2MarketFeedsStatus([], 1_000)
    expect(result.status).toBe('inactive')
    expect(result.capability_active).toBe(false)
    expect(result.feeds).toEqual([])
  })

  it('reports paper safety and legacy authority honestly', () => {
    const metrics = new DecisionMetricsStore()
    const result = buildV2InfrastructureStatus({
      guardian: {
        halted: false,
        reason: null,
        drawdownPct: 0,
        maxDrawdownPct: 15,
      },
      feeds: [],
      metrics,
      d1Status: 'healthy',
      nowMs: 1_000,
    })

    expect(result.version).toBe('2.0')
    expect(result.runtime.trading_mode).toBe('paper')
    expect(result.runtime.exchange_mode).toBe('paper')
    expect(result.runtime.network).toBe('testnet')
    expect(result.runtime.allow_mainnet).toBe(false)
    expect(result.runtime.live_trading_enabled).toBe(false)
    expect(result.runtime.withdrawals_enabled).toBe(false)
    expect(result.fast_path.authority).toBe('legacy_d1')
    expect(result.fast_path.target_authority).toBe('portfolio_durable_object')
    expect(result.fast_path.shadow_mode).toBe(false)
    expect(result.fast_path.decision_latency_ms).toBeNull()
    expect(result.projections.queue_status).toBe('not_reported')
    expect(result.feeds).toEqual([])
  })

  it('returns measured percentiles only after samples exist', () => {
    const metrics = new DecisionMetricsStore()
    expect(metrics.snapshot('15m', 1_000).sample_count).toBe(0)
    expect(metrics.snapshot('15m', 1_000).decision_latency_ms.p95).toBeNull()

    metrics.record({
      decisionLatencyMs: 5,
      decisionDataAgeMs: 25,
      duplicateRejected: false,
      staleRejected: false,
      recordedAtMs: 900,
    })
    metrics.record({
      decisionLatencyMs: 10,
      decisionDataAgeMs: 50,
      duplicateRejected: true,
      staleRejected: false,
      recordedAtMs: 950,
    })

    const measured = metrics.snapshot('15m', 1_000)
    expect(measured.sample_count).toBe(2)
    expect(measured.decision_latency_ms.p50).toBe(5)
    expect(measured.decision_latency_ms.p95).toBe(10)
    expect(measured.duplicate_reject_rate).toBe(0.5)
    expect(measured.measurement_scope).toBe('ephemeral_worker_isolate')
  })
})
