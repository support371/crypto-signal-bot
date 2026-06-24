import type { FeedHealthState } from '../fast-path/types'
import { buildV2MarketFeedsStatus } from './v2-market-feeds'
import type { DecisionMetricsStore } from './v2-metrics'

export interface V2GuardianSnapshot {
  halted: boolean
  reason: string | null
  drawdownPct: number
  maxDrawdownPct: number
}

export interface V2InfrastructureInput {
  guardian: V2GuardianSnapshot
  feeds: FeedHealthState[]
  metrics: DecisionMetricsStore
  d1Status: 'healthy' | 'degraded' | 'unavailable' | 'not_reported'
  nowMs?: number
}

export function buildV2InfrastructureStatus(input: V2InfrastructureInput) {
  const nowMs = input.nowMs ?? Date.now()
  const feedStatus = buildV2MarketFeedsStatus(input.feeds, nowMs)
  const decisionMetrics = input.metrics.snapshot('15m', nowMs)
  const activeFeedCount = feedStatus.feeds.filter((feed) => feed.integrity_state === 'healthy').length

  return {
    version: '2.0' as const,
    generated_at: new Date(nowMs).toISOString(),
    runtime: {
      trading_mode: 'paper' as const,
      exchange_mode: 'paper' as const,
      network: 'testnet' as const,
      allow_mainnet: false,
      live_trading_enabled: false,
      withdrawals_enabled: false,
    },
    guardian: {
      halted: input.guardian.halted,
      reason: input.guardian.reason,
      drawdown_pct: input.guardian.drawdownPct,
      max_drawdown_pct: input.guardian.maxDrawdownPct,
    },
    fast_path: {
      authority: 'legacy_d1' as const,
      target_authority: 'portfolio_durable_object' as const,
      shadow_mode: activeFeedCount > 0,
      decision_latency_ms: decisionMetrics.decision_latency_ms.p95,
      decision_data_age_ms: decisionMetrics.decision_data_age_ms.p95,
      ledger_atomicity_failures: decisionMetrics.ledger_atomicity_failures,
      measurement_scope: decisionMetrics.measurement_scope,
    },
    feeds: feedStatus.feeds,
    projections: {
      d1_status: input.d1Status,
      queue_status: 'not_reported' as const,
      projection_lag_ms: null,
    },
    capability_state: {
      websocket_gateway: feedStatus.capability_active ? feedStatus.status : 'inactive',
      portfolio_durable_object: 'not_implemented' as const,
      queue_projection: 'not_reported' as const,
    },
  }
}
