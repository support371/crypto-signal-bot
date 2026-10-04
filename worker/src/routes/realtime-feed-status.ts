import type { FeedHealthState } from '../fast-path/types'

/** Project observed feed health; socket connectivity alone is not market health. */
export function buildRealtimeFeedStatus(feeds: readonly FeedHealthState[], source: string) {
  const observed = feeds.filter((feed) => feed.source === source && feed.channel !== 'heartbeats' && feed.symbol !== '*')
  const healthy = observed.filter((feed) => feed.connectionState === 'connected'
    && feed.integrityState === 'healthy' && feed.freshnessClass === 'green'
    && feed.heartbeatState === 'healthy' && feed.lastReceivedTsMs !== null)
  const timestamps = observed.flatMap((feed) => feed.lastReceivedTsMs === null ? [] : [feed.lastReceivedTsMs])
  return {
    type: 'exchange_status' as const,
    exchange: source,
    market_data_mode: 'live_public_paper',
    connected: healthy.length > 0,
    connection_state: observed.length === 0 ? 'not_reported' : healthy.length > 0 ? 'connected' : 'disconnected',
    fallback_active: false,
    last_update_ts: timestamps.length === 0 ? null : Math.max(...timestamps),
    last_error: observed.length === 0 ? 'FEED_HEALTH_NOT_REPORTED' : healthy.length === 0 ? 'FEED_NOT_EXECUTABLE' : null,
    stale: healthy.length === 0,
    symbols: [...new Set(healthy.map((feed) => feed.symbol))].sort(),
    source,
  }
}
