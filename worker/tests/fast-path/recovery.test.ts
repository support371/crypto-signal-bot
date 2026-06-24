import { describe, expect, it } from 'vitest'
import { BinanceDepthRecovery } from '../../src/fast-path/recovery'
import { DEFAULT_FAST_PATH_THRESHOLDS } from '../../src/fast-path/types'
import { eventFixture } from './fixtures'

function binanceDelta(start: number, end: number) {
  return eventFixture({
    eventId: `binance:diff_depth:BTC-USDT:level2:${end}`,
    source: 'binance',
    channel: 'diff_depth',
    symbol: 'BTC-USDT',
    sequenceStart: start,
    sequenceEnd: end,
  })
}

describe('BinanceDepthRecovery', () => {
  it('returns healthy after a valid snapshot bridge', () => {
    const recovery = new BinanceDepthRecovery({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    recovery.begin(1_000)
    recovery.bufferDelta(binanceDelta(101, 102), 1_010)
    recovery.bufferDelta(binanceDelta(103, 104), 1_020)

    const result = recovery.applySnapshot(100, 1_030)
    expect(result.state).toBe('healthy')
    expect(result.lastSequence).toBe(104)
    expect(result.accepted).toHaveLength(2)
    expect(result.errorCode).toBeNull()
  })

  it('rejects buffered events older than the snapshot', () => {
    const recovery = new BinanceDepthRecovery({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    recovery.begin(1_000)
    recovery.bufferDelta(binanceDelta(90, 99), 1_010)
    recovery.bufferDelta(binanceDelta(101, 101), 1_020)

    const result = recovery.applySnapshot(100, 1_030)
    expect(result.state).toBe('healthy')
    expect(result.accepted).toHaveLength(1)
    expect(result.rejected).toHaveLength(1)
  })

  it('hard-resyncs when continuity breaks after the bridge', () => {
    const recovery = new BinanceDepthRecovery({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    recovery.begin(1_000)
    recovery.bufferDelta(binanceDelta(101, 101), 1_010)
    recovery.bufferDelta(binanceDelta(103, 103), 1_020)

    const result = recovery.applySnapshot(100, 1_030)
    expect(result.state).toBe('resyncing')
    expect(result.errorCode).toBe('SEQUENCE_GAP')
    expect(result.lastSequence).toBe(101)
  })

  it('becomes unavailable after recovery timeout', () => {
    const recovery = new BinanceDepthRecovery({ ...DEFAULT_FAST_PATH_THRESHOLDS })
    recovery.begin(1_000)
    recovery.bufferDelta(binanceDelta(101, 101), 1_010)

    const now = 1_000 + DEFAULT_FAST_PATH_THRESHOLDS.recoveryTimeoutMs + 1
    expect(recovery.tick(now)).toBe('unavailable')
    const result = recovery.applySnapshot(100, now)
    expect(result.state).toBe('unavailable')
    expect(result.errorCode).toBe('RECOVERY_TIMEOUT')
  })
})
