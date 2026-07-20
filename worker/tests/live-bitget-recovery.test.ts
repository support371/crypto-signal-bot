import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BitgetReadOnlyRecoveryClient,
  BitgetRecoveryIncompleteError,
  buildBitgetRestRecoveryResult,
} from '../src/live/adapters/bitget/recovery.ts'
import type { BitgetReadOnlyClient } from '../src/live/adapters/bitget/read-only-client.ts'
import {
  initialBitgetUserStreamCursor,
  markBitgetUserStreamConnected,
} from '../src/live/adapters/bitget/user-stream.ts'

const startTimeMs = 1784322000000
const endTimeMs = 1784325600000

function cursor() {
  return {
    ...markBitgetUserStreamConnected(
      initialBitgetUserStreamCursor(),
      '2026-07-17T21:00:00.000Z',
    ),
    ordersSubscribed: true,
    fillsSubscribed: true,
  }
}

function order(
  orderId: string,
  status: string,
  updatedAtMs: number,
  filled = '0',
) {
  return {
    symbol: 'BTCUSDT',
    orderId,
    clientOid: `client-${orderId}`,
    size: '0.01',
    orderType: 'limit',
    side: 'buy',
    baseVolume: filled,
    quoteVolume: filled === '0' ? '0' : '100',
    priceAvg: filled === '0' ? '0' : '50000',
    status,
    feeDetail: { totalFee: '0.1', feeCoin: 'USDT' },
    cTime: '1784322000000',
    uTime: String(updatedAtMs),
  }
}

function fill(tradeId: string, price = '50000') {
  return {
    symbol: 'BTCUSDT',
    orderId: 'order-1',
    tradeId,
    side: 'buy',
    priceAvg: price,
    size: '0.002',
    feeDetail: { totalFee: '0.1', feeCoin: 'USDT' },
    cTime: '1784325000000',
    uTime: '1784325000000',
  }
}

function envelope(data: unknown[], requestTime = endTimeMs) {
  return { code: '00000', msg: 'success', requestTime, data }
}

test('REST recovery chooses newest order state and deduplicates identical fills', async () => {
  const result = await buildBitgetRestRecoveryResult(
    cursor(),
    { symbol: 'BTC-USDT', startTimeMs, endTimeMs, limit: 100 },
    {
      currentOrders: envelope([order('order-1', 'partially_filled', 1784325500000, '0.002')]),
      historyOrders: envelope([
        order('order-1', 'live', 1784324000000),
        order('order-2', 'filled', 1784325300000, '0.01'),
      ]),
      fills: envelope([fill('trade-1'), fill('trade-1')]),
    },
    '2026-07-17T22:00:00.000Z',
  )

  assert.equal(result.snapshot.orders.length, 2)
  assert.equal(
    result.snapshot.orders.find((item) => item.exchangeOrderId === 'order-1')?.rawStatus,
    'partially_filled',
  )
  assert.equal(result.snapshot.fills.length, 1)
  assert.equal(result.currentOrderCount, 1)
  assert.equal(result.historicalOrderCount, 2)
  assert.equal(result.fillCount, 1)
  assert.equal(result.cursor.initialized, true)
  assert.equal(result.cursor.recoveryRequired, false)
  assert.equal(result.cursor.ordersSubscribed, true)
  assert.equal(result.cursor.fillsSubscribed, true)
  assert.equal(result.readOnly, true)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.match(result.snapshotHash, /^[a-f0-9]{64}$/)
})

test('saturated REST page remains recovery-incomplete', async () => {
  await assert.rejects(
    buildBitgetRestRecoveryResult(
      cursor(),
      { symbol: 'BTCUSDT', startTimeMs, endTimeMs, limit: 1 },
      {
        currentOrders: envelope([order('order-1', 'live', 1784325500000)]),
        historyOrders: envelope([]),
        fills: envelope([]),
      },
      '2026-07-17T22:00:00.000Z',
    ),
    (error: unknown) => error instanceof BitgetRecoveryIncompleteError
      && /pagination is required/.test(error.message),
  )
})

test('conflicting fill identity fails closed', async () => {
  await assert.rejects(
    buildBitgetRestRecoveryResult(
      cursor(),
      { symbol: 'BTCUSDT', startTimeMs, endTimeMs, limit: 100 },
      {
        currentOrders: envelope([]),
        historyOrders: envelope([]),
        fills: envelope([fill('trade-1', '50000'), fill('trade-1', '50001')]),
      },
      '2026-07-17T22:00:00.000Z',
    ),
    (error: unknown) => error instanceof BitgetRecoveryIncompleteError
      && /conflicting fill snapshot/.test(error.message),
  )
})

test('recovery window cannot exceed Bitget ninety-day history boundary', async () => {
  await assert.rejects(
    buildBitgetRestRecoveryResult(
      cursor(),
      {
        symbol: 'BTCUSDT',
        startTimeMs: 0,
        endTimeMs: 91 * 24 * 60 * 60 * 1000,
        limit: 100,
      },
      {
        currentOrders: envelope([]),
        historyOrders: envelope([]),
        fills: envelope([]),
      },
      '2026-07-17T22:00:00.000Z',
    ),
    /must not exceed 90 days/,
  )
})

test('read-only recovery client calls only current orders, history, and fills', async () => {
  const calls: Array<{ method: string; query: unknown }> = []
  const client = {
    listCurrentOrders: async (query: unknown) => {
      calls.push({ method: 'listCurrentOrders', query })
      return envelope([])
    },
    listHistoryOrders: async (query: unknown) => {
      calls.push({ method: 'listHistoryOrders', query })
      return envelope([])
    },
    listFills: async (query: unknown) => {
      calls.push({ method: 'listFills', query })
      return envelope([])
    },
  } as unknown as BitgetReadOnlyClient
  const recovery = new BitgetReadOnlyRecoveryClient(client)
  const result = await recovery.recover(
    cursor(),
    { symbol: 'BTC-USDT', startTimeMs, endTimeMs, limit: 100 },
    '2026-07-17T22:00:00.000Z',
  )

  assert.deepEqual(calls.map((call) => call.method), [
    'listCurrentOrders',
    'listHistoryOrders',
    'listFills',
  ])
  assert.equal(result.snapshot.orders.length, 0)
  assert.equal(result.snapshot.fills.length, 0)
})
