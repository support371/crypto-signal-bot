export * from './types'
export * from './events'
export * from './freshness'
export * from './feed-health'
export * from './recovery'
export * from './normalizers/coinbase'
export * from './normalizers/binance'

import { FeedHealthRegistry } from './feed-health'
import { DEFAULT_FAST_PATH_THRESHOLDS } from './types'
import { DecisionMetricsStore } from '../routes/v2-metrics'

/**
 * Ephemeral per-isolate shadow state for Phases 1–2.
 * It is not portfolio authority and is not used by the legacy order engine.
 */
export const fastPathFeedRegistry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
export const fastPathDecisionMetrics = new DecisionMetricsStore()
