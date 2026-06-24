export type MarketSource = 'coinbase' | 'binance'
export type MarketEventKind = 'level2' | 'book_ticker' | 'trade' | 'heartbeat' | 'snapshot'
export type IntegrityState = 'healthy' | 'degraded' | 'resyncing' | 'unavailable' | 'not_reported'
export type FreshnessClass = 'green' | 'amber' | 'red' | 'not_reported'
export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'not_reported'
export type SequenceState = 'continuous' | 'bootstrap' | 'duplicate' | 'out_of_order' | 'gap' | 'not_reported'
export type HeartbeatState = 'healthy' | 'stale' | 'missing' | 'not_reported'
export type RecoveryState = 'idle' | 'loading_snapshot' | 'buffering' | 'bridging' | 'healthy' | 'resyncing' | 'unavailable'
export type PriceOrigin = 'live' | 'cache' | 'static' | 'request' | 'not_reported'
export type MarketAction = 'entry' | 'scale_in' | 'reduction' | 'protective_reduction'

export interface BookUpdate {
  side: 'bid' | 'ask'
  price: number
  quantity: number
}

export interface NormalizedMarketEvent {
  version: '2.0'
  eventId: string
  source: MarketSource
  channel: string
  kind: MarketEventKind
  symbol: string
  exchangeTsMs: number
  receivedTsMs: number
  sequenceStart?: number
  sequenceEnd?: number
  bid?: number
  ask?: number
  updates?: BookUpdate[]
  rawDigest?: string
}

export interface FastPathThresholds {
  greenMaxAgeMs: number
  amberMaxAgeMs: number
  heartbeatTimeoutMs: number
  recoveryTimeoutMs: number
  maxBufferedEvents: number
  maxTrackedFeeds: number
  maxSeenEventIds: number
}

export const DEFAULT_FAST_PATH_THRESHOLDS: Readonly<FastPathThresholds> = Object.freeze({
  greenMaxAgeMs: 500,
  amberMaxAgeMs: 1500,
  heartbeatTimeoutMs: 5000,
  recoveryTimeoutMs: 10_000,
  maxBufferedEvents: 2000,
  maxTrackedFeeds: 256,
  maxSeenEventIds: 10_000,
})

export interface FeedHealthState {
  source: MarketSource
  channel: string
  symbol: string
  connectionState: ConnectionState
  integrityState: IntegrityState
  sequenceState: SequenceState
  heartbeatState: HeartbeatState
  recoveryState: RecoveryState
  lastSequence: number | null
  lastExchangeTsMs: number | null
  lastReceivedTsMs: number | null
  lastHeartbeatTsMs: number | null
  eventAgeMs: number | null
  freshnessClass: FreshnessClass
  gapCount: number
  duplicateCount: number
  outOfOrderCount: number
  acceptedEventCount: number
  rejectedEventCount: number
  recoveryStartedAtMs: number | null
  recoveryCompletedAtMs: number | null
  lastErrorCode: string | null
  ephemeral: true
}

export interface FeedUpdateResult {
  accepted: boolean
  reason: 'accepted' | 'heartbeat' | 'duplicate' | 'out_of_order' | 'sequence_gap' | 'invalid'
  state: FeedHealthState
}

export interface MarketAuthorizationInput {
  action: MarketAction
  freshnessClass: FreshnessClass
  integrityState: IntegrityState
  sequenceState: SequenceState
  heartbeatState: HeartbeatState
  priceOrigin: PriceOrigin
  secondaryConfirmed: boolean
  stricterRiskApproved?: boolean
}

export interface MarketAuthorizationResult {
  allowed: boolean
  code:
    | 'ALLOWED'
    | 'NON_EXECUTABLE_PRICE'
    | 'STALE_MARKET_DATA'
    | 'SEQUENCE_GAP'
    | 'HEARTBEAT_UNHEALTHY'
    | 'SECONDARY_CONFIRMATION_REQUIRED'
    | 'INVALID_RISK_DECISION'
  message: string
}

export interface DecisionMetricSample {
  decisionLatencyMs: number
  decisionDataAgeMs: number
  duplicateRejected: boolean
  staleRejected: boolean
  recordedAtMs: number
}

export interface PercentileSummary {
  p50: number | null
  p95: number | null
  p99: number | null
}
