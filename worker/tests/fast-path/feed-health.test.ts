import { describe, expect, it } from 'vitest'
import { FeedHealthRegistry } from '../../src/fast-path/feed-health'
import { DEFAULT_FAST_PATH_THRESHOLDS } from '../../src/fast-path/types'
import { eventFixture, heartbeatFixture } from './fixtures'

const key = 'coinbase:l2_data:BTC-USD'

describe('FeedHealthRegistry', () => {
  it('requires heartbeat before reporting a healthy feed', () => {
    const registry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    registry.ingest(eventFixture(), 1_010)
    expect(registry.get(key, 1_010)?.integrityState).toBe('degraded')

    registry.ingest(heartbeatFixture(), 1_020)
    const state = registry.get(key, 1_020)
    expect(state?.heartbeatState).toBe('healthy')
    expect(state?.integrityState).toBe('healthy')
    expect(state?.freshnessClass).toBe('green')
  })

  it('rejects duplicate event ids without advancing state', () => {
    const registry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    const event = eventFixture()
    expect(registry.ingest(event).accepted).toBe(true)
    const duplicate = registry.ingest(event)
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.reason).toBe('duplicate')
    expect(duplicate.state.duplicateCount).toBe(1)
    expect(duplicate.state.lastSequence).toBe(1)
  })

  it('detects a skipped sequence and enters resyncing state', () => {
    const registry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    registry.ingest(eventFixture({ sequenceStart: 1, sequenceEnd: 1 }))
    registry.ingest(heartbeatFixture())
    const result = registry.ingest(eventFixture({
      eventId: 'coinbase:l2_data:BTC-USD:level2:3',
      sequenceStart: 3,
      sequenceEnd: 3,
      receivedTsMs: 1_030,
    }), 1_030)

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('sequence_gap')
    expect(result.state.integrityState).toBe('resyncing')
    expect(result.state.gapCount).toBe(1)
  })

  it('rejects out-of-order sequences', () => {
    const registry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    registry.ingest(eventFixture({ sequenceStart: 5, sequenceEnd: 5 }))
    const result = registry.ingest(eventFixture({
      eventId: 'coinbase:l2_data:BTC-USD:level2:4',
      sequenceStart: 4,
      sequenceEnd: 4,
    }))
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('out_of_order')
    expect(result.state.outOfOrderCount).toBe(1)
  })

  it('marks stalled recovery unavailable after timeout', () => {
    const registry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    registry.ingest(eventFixture({ sequenceStart: 1, sequenceEnd: 1 }), 1_010)
    registry.ingest(eventFixture({
      eventId: 'coinbase:l2_data:BTC-USD:level2:3',
      sequenceStart: 3,
      sequenceEnd: 3,
      receivedTsMs: 1_030,
    }), 1_030)

    const expired = registry.get(key, 1_030 + DEFAULT_FAST_PATH_THRESHOLDS.recoveryTimeoutMs + 1)
    expect(expired?.recoveryState).toBe('unavailable')
    expect(expired?.integrityState).toBe('unavailable')
    expect(expired?.lastErrorCode).toBe('RECOVERY_TIMEOUT')
  })

  it('marks a heartbeat stale after the configured timeout', () => {
    const registry = new FeedHealthRegistry({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    registry.ingest(eventFixture(), 1_010)
    registry.ingest(heartbeatFixture(), 1_020)
    const stale = registry.get(key, 1_020 + DEFAULT_FAST_PATH_THRESHOLDS.heartbeatTimeoutMs + 1)
    expect(stale?.heartbeatState).toBe('stale')
    expect(stale?.integrityState).toBe('degraded')
    expect(stale?.freshnessClass).toBe('red')
  })

  it('correctly evicts the oldest event IDs in a circular FIFO ring buffer pattern', () => {
    const customThresholds = {
      ...DEFAULT_FAST_PATH_THRESHOLDS,
      maxSeenEventIds: 3,
    }
    const registry = new FeedHealthRegistry(customThresholds)

    // Ingest 3 events (fill the ring buffer)
    const e1 = eventFixture({ eventId: 'evt-1', sequenceStart: 1, sequenceEnd: 1 })
    const e2 = eventFixture({ eventId: 'evt-2', sequenceStart: 2, sequenceEnd: 2 })
    const e3 = eventFixture({ eventId: 'evt-3', sequenceStart: 3, sequenceEnd: 3 })

    expect(registry.ingest(e1).accepted).toBe(true)
    expect(registry.ingest(e2).accepted).toBe(true)
    expect(registry.ingest(e3).accepted).toBe(true)

    // They are currently tracked, so duplicate checks should reject them
    expect(registry.ingest(e1).reason).toBe('duplicate')
    expect(registry.ingest(e2).reason).toBe('duplicate')
    expect(registry.ingest(e3).reason).toBe('duplicate')

    // Ingest a 4th event, which should evict the oldest: 'evt-1' (write index 0)
    const e4 = eventFixture({ eventId: 'evt-4', sequenceStart: 4, sequenceEnd: 4 })
    expect(registry.ingest(e4).accepted).toBe(true)

    // Now 'evt-1' is evicted and should be accepted again.
    const e1New = eventFixture({ eventId: 'evt-1', sequenceStart: 5, sequenceEnd: 5 })
    expect(registry.ingest(e1New).accepted).toBe(true) // no longer rejected as duplicate

    // Since 'evt-3' is still in the cache, ingesting an event with 'evt-3' and sequence 2 is rejected as 'duplicate'
    const e3Duplicate = eventFixture({ eventId: 'evt-3', sequenceStart: 2, sequenceEnd: 2 })
    expect(registry.ingest(e3Duplicate).reason).toBe('duplicate')

    // Since 'evt-2' has been evicted, an event with 'evt-2' and a valid continuous sequence (6) should be accepted.
    const e2New = eventFixture({ eventId: 'evt-2', sequenceStart: 6, sequenceEnd: 6 })
    expect(registry.ingest(e2New).accepted).toBe(true)
  })
})
