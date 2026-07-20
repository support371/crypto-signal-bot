import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchBitgetPublicClosedCandles } from '../src/certification/bitget-public-candles.ts'
import { evaluateCertificationSignal } from '../src/certification/signal-engine.ts'

const INTERVAL_MS = 5 * 60 * 1000
const CLOSED_BOUNDARY = 1_800_000_000_000
const NOW = CLOSED_BOUNDARY + 60_000

function candleRows(direction: 'up' | 'down', count = 40): string[][] {
  let close = 50_000
  const rows: string[][] = []
  for (let index = 0; index < count; index += 1) {
    const open = close
    const change = direction === 'up'
      ? (index % 2 === 0 ? -1 : 2)
      : (index % 2 === 0 ? 1 : -2)
    close += change
    const high = Math.max(open, close) + 1
    const low = Math.min(open, close) - 1
    const start = CLOSED_BOUNDARY - (count - index) * INTERVAL_MS
    rows.push([
      String(start),
      String(open),
      String(high),
      String(low),
      String(close),
      '10',
      String(close * 10),
      String(close * 10),
    ])
  }
  return rows
}

function envelope(rows: readonly string[][]): Response {
  return Response.json({
    code: '00000',
    msg: 'success',
    requestTime: NOW,
    data: [...rows].reverse(),
  })
}

test('Bitget public candle transport is bounded, GET-only, credential-free, and closed-candle scoped', async () => {
  let observedUrl = ''
  let observedInit: RequestInit | undefined
  const snapshot = await fetchBitgetPublicClosedCandles('btcusdt', {
    now: () => NOW,
    fetcher: async (input, init) => {
      observedUrl = String(input)
      observedInit = init
      return envelope(candleRows('up'))
    },
  })

  const url = new URL(observedUrl)
  assert.equal(url.origin, 'https://api.bitget.com')
  assert.equal(url.pathname, '/api/v2/spot/market/candles')
  assert.equal(url.searchParams.get('symbol'), 'BTCUSDT')
  assert.equal(url.searchParams.get('granularity'), '5min')
  assert.equal(url.searchParams.get('endTime'), String(CLOSED_BOUNDARY - 1))
  assert.equal(url.searchParams.get('limit'), '100')
  assert.equal(observedInit?.method, 'GET')
  assert.equal(observedInit?.redirect, 'error')
  assert.deepEqual(observedInit?.headers, { Accept: 'application/json' })
  assert.doesNotMatch(JSON.stringify(observedInit), /authorization|api[-_]?key|passphrase|secret/i)
  assert.equal(snapshot.productSymbol, 'BTCUSDT')
  assert.equal(snapshot.candles.length, 40)
  assert.ok(snapshot.candles[0]!.startMs < snapshot.candles.at(-1)!.startMs)
  assert.equal(snapshot.latestClosedAtMs, CLOSED_BOUNDARY)
  assert.match(snapshot.sourceHash, /^[a-f0-9]{64}$/)
  assert.equal(snapshot.publicReadOnly, true)
  assert.equal(snapshot.credentialsUsed, false)
  assert.equal(snapshot.providerMutationAllowed, false)
  assert.equal(snapshot.executionAllowed, false)
  assert.equal(snapshot.realFundsAllowed, false)
})

test('certification evaluator emits deterministic BUY evidence without execution authority', async () => {
  const snapshot = await fetchBitgetPublicClosedCandles('BTCUSDT', {
    now: () => NOW,
    fetcher: async () => envelope(candleRows('up')),
  })
  const first = await evaluateCertificationSignal(snapshot, NOW)
  const second = await evaluateCertificationSignal(snapshot, NOW)

  assert.equal(first.direction, 'BUY')
  assert.equal(first.confidenceBps, 7_000)
  assert.ok(first.indicators.rsi14Bps >= 5_200)
  assert.ok(first.indicators.rsi14Bps <= 7_200)
  assert.equal(first.indicators.volumeMethod, 'CANDLE_DIRECTION_PROXY')
  assert.ok(Number(first.indicators.directionalVolumeDelta) > 0)
  assert.deepEqual(first.reasons, [
    'ema12_above_ema26',
    'rsi14_supports_uptrend',
    'directional_volume_positive',
  ])
  assert.equal(first.evidenceHash, second.evidenceHash)
  assert.equal(first.requiresIndependentRiskDecision, true)
  assert.equal(first.providerMutationAllowed, false)
  assert.equal(first.executionAllowed, false)
  assert.equal(first.realFundsAllowed, false)
  assert.equal(first.mainnetAllowed, false)
  assert.equal(first.withdrawalsAllowed, false)
})

test('certification evaluator emits deterministic SELL evidence for aligned downtrend', async () => {
  const snapshot = await fetchBitgetPublicClosedCandles('BTCUSDT', {
    now: () => NOW,
    fetcher: async () => envelope(candleRows('down')),
  })
  const evidence = await evaluateCertificationSignal(snapshot, NOW)
  assert.equal(evidence.direction, 'SELL')
  assert.ok(evidence.indicators.rsi14Bps >= 2_800)
  assert.ok(evidence.indicators.rsi14Bps <= 4_800)
  assert.ok(Number(evidence.indicators.directionalVolumeDelta) < 0)
})

test('stale or tampered candle evidence fails closed', async () => {
  const snapshot = await fetchBitgetPublicClosedCandles('BTCUSDT', {
    now: () => NOW,
    fetcher: async () => envelope(candleRows('up')),
  })
  await assert.rejects(
    evaluateCertificationSignal(snapshot, snapshot.latestClosedAtMs + 10 * 60 * 1000 + 1),
    /stale/,
  )
  const tampered = {
    ...snapshot,
    candles: snapshot.candles.map((candle, index) => index === 0
      ? { ...candle, close: '1' as typeof candle.close }
      : candle),
  }
  await assert.rejects(
    evaluateCertificationSignal(tampered, NOW),
    /source hash does not match/,
  )
})

test('malformed, incomplete, non-success, and oversized candle responses are rejected', async () => {
  await assert.rejects(
    fetchBitgetPublicClosedCandles('BTC-USDT', { now: () => NOW, fetcher: async () => envelope(candleRows('up')) }),
    /uppercase USDT spot symbol/,
  )
  await assert.rejects(
    fetchBitgetPublicClosedCandles('BTCUSDT', { now: () => NOW, fetcher: async () => envelope(candleRows('up', 20)) }),
    /between 35 and 100/,
  )
  await assert.rejects(
    fetchBitgetPublicClosedCandles('BTCUSDT', {
      now: () => NOW,
      fetcher: async () => Response.json({ code: '40001', msg: 'error', data: [] }),
    }),
    /non-success envelope/,
  )
  await assert.rejects(
    fetchBitgetPublicClosedCandles('BTCUSDT', {
      now: () => NOW,
      fetcher: async () => new Response('{}', { headers: { 'Content-Length': '999999' } }),
    }),
    /byte limit/,
  )
})
