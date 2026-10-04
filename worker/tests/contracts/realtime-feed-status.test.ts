import { describe, expect, it } from 'vitest'
import { FeedHealthRegistry } from '../../src/fast-path/feed-health'
import { buildRealtimeFeedStatus } from '../../src/routes/realtime-feed-status'
import { eventFixture, heartbeatFixture } from '../fast-path/fixtures'

describe('truthful realtime feed evidence', () => {
  it('does not treat an open dashboard socket as a healthy market feed', () => {
    const result = buildRealtimeFeedStatus([], 'coinbase')
    expect(result.connected).toBe(false)
    expect(result.connection_state).toBe('not_reported')
    expect(result.last_update_ts).toBeNull()
    expect(result.stale).toBe(true)
  })

  it('reports observed healthy feeds then clears connectivity when their evidence ages', () => {
    const registry = new FeedHealthRegistry()
    registry.ingest(eventFixture(), 1010)
    registry.ingest(heartbeatFixture(), 1020)
    const fresh = buildRealtimeFeedStatus(registry.list(1020), 'coinbase')
    expect(fresh.connected).toBe(true)
    expect(fresh.symbols).toEqual(['BTC-USD'])
    expect(fresh.last_update_ts).toBe(1010)
    const stale = buildRealtimeFeedStatus(registry.list(10000), 'coinbase')
    expect(stale.connected).toBe(false)
    expect(stale.last_update_ts).toBe(1010)
    expect(stale.symbols).toEqual([])
  })

  it('cannot use another provider health as evidence for the selected source', () => {
    const registry = new FeedHealthRegistry()
    registry.ingest(eventFixture(), 1010)
    registry.ingest(heartbeatFixture(), 1020)
    expect(buildRealtimeFeedStatus(registry.list(1020), 'bitget').connection_state).toBe('not_reported')
  })
})
