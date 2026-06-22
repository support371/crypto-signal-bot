import type { FeedHealthState } from '../fast-path/types'

export function buildV2MarketFeedsStatus(feeds: FeedHealthState[], nowMs = Date.now()) {
  const mapped = feeds.map((feed) => ({
    source: feed.source,
    channel: feed.channel,
    symbol: feed.symbol,
    connection_state: feed.connectionState,
    integrity_state: feed.integrityState,
    sequence_state: feed.sequenceState,
    heartbeat_state: feed.heartbeatState,
    last_sequence: feed.lastSequence,
    gap_count: feed.gapCount,
    duplicate_count: feed.duplicateCount,
    out_of_order_count: feed.outOfOrderCount,
    accepted_event_count: feed.acceptedEventCount,
    rejected_event_count: feed.rejectedEventCount,
    event_age_ms: feed.eventAgeMs,
    freshness_class: feed.freshnessClass,
    recovery_state: feed.recoveryState,
    recovery_started_at: feed.recoveryStartedAtMs === null ? null : new Date(feed.recoveryStartedAtMs).toISOString(),
    recovery_completed_at: feed.recoveryCompletedAtMs === null ? null : new Date(feed.recoveryCompletedAtMs).toISOString(),
    last_event_at: feed.lastReceivedTsMs === null ? null : new Date(feed.lastReceivedTsMs).toISOString(),
    last_exchange_event_at: feed.lastExchangeTsMs === null ? null : new Date(feed.lastExchangeTsMs).toISOString(),
    last_heartbeat_at: feed.lastHeartbeatTsMs === null ? null : new Date(feed.lastHeartbeatTsMs).toISOString(),
    last_error_code: feed.lastErrorCode,
    storage_scope: 'ephemeral_worker_isolate' as const,
  }))

  const status = mapped.length === 0
    ? 'inactive'
    : mapped.every((feed) => feed.integrity_state === 'healthy')
      ? 'active'
      : 'degraded'

  return {
    version: '2.0' as const,
    generated_at: new Date(nowMs).toISOString(),
    status,
    capability_active: mapped.length > 0,
    message: mapped.length > 0
      ? 'Feed health reflects bounded in-memory events received by this Worker isolate.'
      : 'No WebSocket feed gateway is active in this Worker isolate; no connected feeds are reported.',
    feeds: mapped,
  }
}
