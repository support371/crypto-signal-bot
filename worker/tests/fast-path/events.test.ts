import { describe, expect, it } from 'vitest'
import { classifySequence, normalizeMarketSymbol, validateNormalizedEvent } from '../../src/fast-path/events'
import { normalizeCoinbaseMessage } from '../../src/fast-path/normalizers/coinbase'
import { normalizeBinanceMessage } from '../../src/fast-path/normalizers/binance'
import { eventFixture } from './fixtures'

describe('market event normalization', () => {
  it('normalizes Coinbase level2 updates', () => {
    const [event] = normalizeCoinbaseMessage({
      channel: 'l2_data',
      timestamp: '2026-06-22T12:00:00.000Z',
      sequence_num: 42,
      events: [{
        type: 'update',
        product_id: 'BTC-USD',
        updates: [
          { side: 'bid', price_level: '100', new_quantity: '2' },
          { side: 'offer', price_level: '101', new_quantity: '3' },
        ],
      }],
    }, 1_000)

    expect(event.source).toBe('coinbase')
    expect(event.kind).toBe('level2')
    expect(event.symbol).toBe('BTC-USD')
    expect(event.sequenceEnd).toBe(42)
    expect(event.bid).toBe(100)
    expect(event.ask).toBe(101)
    expect(validateNormalizedEvent(event)).toEqual([])
  })

  it('normalizes Binance diff-depth updates', () => {
    const [event] = normalizeBinanceMessage({
      e: 'depthUpdate',
      E: 1_000,
      s: 'BTCUSDT',
      U: 10,
      u: 12,
      b: [['100', '2']],
      a: [['101', '3']],
    }, 1_010)

    expect(event.source).toBe('binance')
    expect(event.channel).toBe('diff_depth')
    expect(event.symbol).toBe('BTC-USDT')
    expect(event.sequenceStart).toBe(10)
    expect(event.sequenceEnd).toBe(12)
    expect(event.bid).toBe(100)
    expect(event.ask).toBe(101)
  })

  it('classifies duplicate, out-of-order, gap, and continuous sequences', () => {
    expect(classifySequence(10, 11, 11)).toBe('continuous')
    expect(classifySequence(10, 10, 10)).toBe('duplicate')
    expect(classifySequence(10, 8, 9)).toBe('out_of_order')
    expect(classifySequence(10, 12, 12)).toBe('gap')
  })

  it('normalizes compact symbols', () => {
    expect(normalizeMarketSymbol('ETHUSDT')).toBe('ETH-USDT')
    expect(normalizeMarketSymbol('SOL/USD')).toBe('SOL-USD')
  })

  it('rejects malformed normalized events', () => {
    const event = eventFixture({ exchangeTsMs: 0 })
    expect(validateNormalizedEvent(event)).toContain('invalid_exchange_timestamp')
  })
})
