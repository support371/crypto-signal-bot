import type { NormalizedMarketEvent } from '../../src/fast-path/types'

export function eventFixture(overrides: Partial<NormalizedMarketEvent> = {}): NormalizedMarketEvent {
  const sequence = overrides.sequenceEnd ?? overrides.sequenceStart ?? 1
  return {
    version: '2.0',
    eventId: `coinbase:l2_data:BTC-USD:level2:${sequence}`,
    source: 'coinbase',
    channel: 'l2_data',
    kind: 'level2',
    symbol: 'BTC-USD',
    exchangeTsMs: 1_000,
    receivedTsMs: 1_010,
    sequenceStart: sequence,
    sequenceEnd: sequence,
    bid: 100,
    ask: 101,
    ...overrides,
  }
}

export function heartbeatFixture(overrides: Partial<NormalizedMarketEvent> = {}): NormalizedMarketEvent {
  return eventFixture({
    eventId: 'coinbase:heartbeats:*:heartbeat:1',
    channel: 'heartbeats',
    kind: 'heartbeat',
    symbol: '*',
    sequenceStart: 1,
    sequenceEnd: 1,
    exchangeTsMs: 1_015,
    receivedTsMs: 1_020,
    bid: undefined,
    ask: undefined,
    ...overrides,
  })
}
