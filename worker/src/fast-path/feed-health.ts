import { classifySequence, feedKey, isHeartbeatEvent, validateNormalizedEvent } from './events'
import { classifyFreshness } from './freshness'
import {
  DEFAULT_FAST_PATH_THRESHOLDS,
  type FastPathThresholds,
  type FeedHealthState,
  type FeedUpdateResult,
  type HeartbeatState,
  type IntegrityState,
  type NormalizedMarketEvent,
} from './types'

type MutableFeedState = Omit<FeedHealthState, 'ephemeral'> & { ephemeral: true }

function copyState(state: MutableFeedState): FeedHealthState {
  return { ...state }
}

function initialState(event: NormalizedMarketEvent): MutableFeedState {
  return {
    source: event.source,
    channel: event.channel,
    symbol: event.symbol,
    connectionState: 'connected',
    integrityState: 'degraded',
    sequenceState: 'not_reported',
    heartbeatState: 'missing',
    recoveryState: 'idle',
    lastSequence: null,
    lastExchangeTsMs: null,
    lastReceivedTsMs: null,
    lastHeartbeatTsMs: null,
    eventAgeMs: null,
    freshnessClass: 'not_reported',
    gapCount: 0,
    duplicateCount: 0,
    outOfOrderCount: 0,
    acceptedEventCount: 0,
    rejectedEventCount: 0,
    recoveryStartedAtMs: null,
    recoveryCompletedAtMs: null,
    lastErrorCode: null,
    ephemeral: true,
  }
}

export class FeedHealthRegistry {
  private readonly feeds = new Map<string, MutableFeedState>()
  private readonly seenEventIds = new Set<string>()
  private readonly seenEventOrder: string[] = []

  constructor(private readonly thresholds: FastPathThresholds = { ...DEFAULT_FAST_PATH_THRESHOLDS }) {}

  ingest(event: NormalizedMarketEvent, nowMs = event.receivedTsMs): FeedUpdateResult {
    const key = feedKey(event)
    const state = this.getOrCreate(key, event)
    const validationErrors = validateNormalizedEvent(event)

    if (validationErrors.length > 0) {
      state.rejectedEventCount += 1
      state.integrityState = 'unavailable'
      state.lastErrorCode = validationErrors[0]
      this.refreshState(state, nowMs)
      return { accepted: false, reason: 'invalid', state: copyState(state) }
    }

    if (this.seenEventIds.has(event.eventId)) {
      state.duplicateCount += 1
      state.rejectedEventCount += 1
      state.sequenceState = 'duplicate'
      state.lastErrorCode = 'DUPLICATE_EVENT'
      this.refreshState(state, nowMs)
      return { accepted: false, reason: 'duplicate', state: copyState(state) }
    }

    this.rememberEventId(event.eventId)
    state.connectionState = 'connected'
    state.lastReceivedTsMs = event.receivedTsMs
    state.lastExchangeTsMs = event.exchangeTsMs

    if (isHeartbeatEvent(event)) {
      state.lastHeartbeatTsMs = event.receivedTsMs
      state.heartbeatState = 'healthy'
      state.acceptedEventCount += 1
      state.lastErrorCode = null
      this.propagateHeartbeat(event, nowMs)
      this.refreshState(state, nowMs)
      return { accepted: true, reason: 'heartbeat', state: copyState(state) }
    }

    const sequenceState = classifySequence(state.lastSequence, event.sequenceStart, event.sequenceEnd)
    state.sequenceState = sequenceState

    if (sequenceState === 'duplicate') {
      state.duplicateCount += 1
      state.rejectedEventCount += 1
      state.lastErrorCode = 'DUPLICATE_SEQUENCE'
      this.refreshState(state, nowMs)
      return { accepted: false, reason: 'duplicate', state: copyState(state) }
    }

    if (sequenceState === 'out_of_order') {
      state.outOfOrderCount += 1
      state.rejectedEventCount += 1
      state.integrityState = 'degraded'
      state.lastErrorCode = 'OUT_OF_ORDER_EVENT'
      this.refreshState(state, nowMs)
      return { accepted: false, reason: 'out_of_order', state: copyState(state) }
    }

    if (sequenceState === 'gap') {
      state.gapCount += 1
      state.rejectedEventCount += 1
      state.integrityState = 'resyncing'
      state.recoveryState = 'resyncing'
      state.recoveryStartedAtMs = nowMs
      state.recoveryCompletedAtMs = null
      state.lastErrorCode = 'SEQUENCE_GAP'
      this.refreshState(state, nowMs)
      return { accepted: false, reason: 'sequence_gap', state: copyState(state) }
    }

    const end = event.sequenceEnd ?? event.sequenceStart
    if (end !== undefined) state.lastSequence = end
    state.acceptedEventCount += 1
    state.lastErrorCode = null
    if (state.recoveryState !== 'healthy') state.recoveryState = 'idle'
    this.refreshState(state, nowMs)
    return { accepted: true, reason: 'accepted', state: copyState(state) }
  }

  markRecoveryHealthy(key: string, lastSequence: number, nowMs: number): FeedHealthState | null {
    const state = this.feeds.get(key)
    if (!state) return null
    state.lastSequence = lastSequence
    state.sequenceState = 'continuous'
    state.recoveryState = 'healthy'
    state.recoveryCompletedAtMs = nowMs
    state.lastErrorCode = null
    this.refreshState(state, nowMs)
    return copyState(state)
  }

  markUnavailable(key: string, errorCode: string, nowMs: number): FeedHealthState | null {
    const state = this.feeds.get(key)
    if (!state) return null
    state.integrityState = 'unavailable'
    state.recoveryState = 'unavailable'
    state.lastErrorCode = errorCode
    this.refreshState(state, nowMs)
    return copyState(state)
  }

  get(key: string, nowMs = Date.now()): FeedHealthState | null {
    const state = this.feeds.get(key)
    if (!state) return null
    this.refreshState(state, nowMs)
    return copyState(state)
  }

  list(nowMs = Date.now()): FeedHealthState[] {
    return [...this.feeds.values()].map((state) => {
      this.refreshState(state, nowMs)
      return copyState(state)
    })
  }

  clear(): void {
    this.feeds.clear()
    this.seenEventIds.clear()
    this.seenEventOrder.length = 0
  }

  private getOrCreate(key: string, event: NormalizedMarketEvent): MutableFeedState {
    const existing = this.feeds.get(key)
    if (existing) return existing
    if (this.feeds.size >= this.thresholds.maxTrackedFeeds) {
      const oldestKey = this.feeds.keys().next().value as string | undefined
      if (oldestKey) this.feeds.delete(oldestKey)
    }
    const created = initialState(event)
    this.feeds.set(key, created)
    return created
  }

  private rememberEventId(eventId: string): void {
    this.seenEventIds.add(eventId)
    this.seenEventOrder.push(eventId)
    while (this.seenEventOrder.length > this.thresholds.maxSeenEventIds) {
      const oldest = this.seenEventOrder.shift()
      if (oldest) this.seenEventIds.delete(oldest)
    }
  }

  private propagateHeartbeat(event: NormalizedMarketEvent, nowMs: number): void {
    for (const state of this.feeds.values()) {
      const sameSource = state.source === event.source
      const sameSymbol = event.symbol === '*' || state.symbol === event.symbol
      if (!sameSource || !sameSymbol) continue
      state.lastHeartbeatTsMs = event.receivedTsMs
      state.heartbeatState = 'healthy'
      this.refreshState(state, nowMs)
    }
  }

  private refreshState(state: MutableFeedState, nowMs: number): void {
    state.eventAgeMs = state.lastExchangeTsMs === null
      ? null
      : Math.max(0, nowMs - state.lastExchangeTsMs)

    state.heartbeatState = this.heartbeatState(state, nowMs)
    state.integrityState = this.integrityState(state)
    state.freshnessClass = classifyFreshness(
      state.eventAgeMs,
      state.integrityState === 'healthy',
      this.thresholds,
    )

    if (
      state.recoveryState === 'resyncing'
      && state.recoveryStartedAtMs !== null
      && nowMs - state.recoveryStartedAtMs > this.thresholds.recoveryTimeoutMs
    ) {
      state.recoveryState = 'unavailable'
      state.integrityState = 'unavailable'
      state.lastErrorCode = 'RECOVERY_TIMEOUT'
      state.freshnessClass = 'red'
    }
  }

  private heartbeatState(state: MutableFeedState, nowMs: number): HeartbeatState {
    if (state.lastHeartbeatTsMs === null) return 'missing'
    return nowMs - state.lastHeartbeatTsMs <= this.thresholds.heartbeatTimeoutMs ? 'healthy' : 'stale'
  }

  private integrityState(state: MutableFeedState): IntegrityState {
    if (state.recoveryState === 'unavailable') return 'unavailable'
    if (state.recoveryState === 'resyncing' || state.sequenceState === 'gap') return 'resyncing'
    if (state.connectionState !== 'connected') return 'unavailable'
    if (state.sequenceState === 'out_of_order') return 'degraded'
    if (state.heartbeatState !== 'healthy') return 'degraded'
    return 'healthy'
  }
}
