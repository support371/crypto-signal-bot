import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyCoinbaseUserStreamMessage,
  evaluateCoinbaseUserStreamFreshness,
  initialCoinbaseUserStreamCursor,
  recoverCoinbaseUserStreamCursor,
} from '../src/live/adapters/coinbase/user-stream.ts'

function order(orderId: string, status = 'OPEN') {
  return {
    order_id: orderId,
    product_id: 'BTC-USD',
    side: 'BUY',
    client_order_id: `client-${orderId}`,
    status,
    created_time: '2026-07-17T10:00:00.000Z',
    last_update_time: '2026-07-17T10:00:01.000Z',
    order_type: 'MARKET',
    order_configuration: {
      market_market_ioc: { quote_size: '100' },
    },
    filled_size: '0',
    filled_value: '0',
    total_fees: '0',
    pending_cancel: false,
    settled: false,
  }
}

test('initial user snapshot establishes the sequence cursor', () => {
  const decision = applyCoinbaseUserStreamMessage(
    initialCoinbaseUserStreamCursor(),
    {
      channel: 'user',
      sequence_num: 0,
      timestamp: '2026-07-17T10:00:01.000Z',
      events: [{ type: 'snapshot', orders: [order('order-1')] }],
    },
  )

  assert.equal(decision.action, 'APPLY')
  assert.equal(decision.cursor.initialized, true)
  assert.equal(decision.cursor.lastSequence, 0)
  assert.equal(decision.orders.length, 1)
})

test('sequential updates apply while duplicates are ignored', () => {
  const snapshot = applyCoinbaseUserStreamMessage(
    initialCoinbaseUserStreamCursor(),
    {
      channel: 'user',
      sequence_num: 10,
      timestamp: '2026-07-17T10:00:01.000Z',
      events: [{ type: 'snapshot', orders: [] }],
    },
  )
  const update = applyCoinbaseUserStreamMessage(snapshot.cursor, {
    channel: 'user',
    sequence_num: 11,
    timestamp: '2026-07-17T10:00:02.000Z',
    events: [{ type: 'update', orders: [order('order-2')] }],
  })
  const duplicate = applyCoinbaseUserStreamMessage(update.cursor, {
    channel: 'user',
    sequence_num: 11,
    timestamp: '2026-07-17T10:00:03.000Z',
    events: [{ type: 'update', orders: [order('order-2')] }],
  })

  assert.equal(update.action, 'APPLY')
  assert.equal(update.cursor.lastSequence, 11)
  assert.equal(duplicate.action, 'IGNORE_DUPLICATE')
  assert.equal(duplicate.reason, 'duplicate_sequence')
})

test('sequence gaps and out-of-order events require a REST snapshot', () => {
  const cursor = recoverCoinbaseUserStreamCursor(
    20,
    '2026-07-17T10:00:00.000Z',
  )
  const gap = applyCoinbaseUserStreamMessage(cursor, {
    channel: 'user',
    sequence_num: 22,
    timestamp: '2026-07-17T10:00:01.000Z',
    events: [{ type: 'update', orders: [] }],
  })
  const outOfOrder = applyCoinbaseUserStreamMessage(cursor, {
    channel: 'user',
    sequence_num: 19,
    timestamp: '2026-07-17T10:00:01.000Z',
    events: [{ type: 'update', orders: [] }],
  })

  assert.equal(gap.action, 'REST_SNAPSHOT_REQUIRED')
  assert.equal(gap.reason, 'sequence_gap_detected')
  assert.equal(outOfOrder.action, 'REST_SNAPSHOT_REQUIRED')
  assert.equal(outOfOrder.reason, 'out_of_order_sequence')
})

test('initial update without snapshot is rejected', () => {
  const decision = applyCoinbaseUserStreamMessage(
    initialCoinbaseUserStreamCursor(),
    {
      channel: 'user',
      sequence_num: 0,
      timestamp: '2026-07-17T10:00:01.000Z',
      events: [{ type: 'update', orders: [] }],
    },
  )

  assert.equal(decision.action, 'REST_SNAPSHOT_REQUIRED')
  assert.equal(decision.reason, 'initial_user_snapshot_missing')
})

test('heartbeats update freshness without altering the user sequence', () => {
  const recovered = recoverCoinbaseUserStreamCursor(
    30,
    '2026-07-17T10:00:00.000Z',
  )
  const heartbeat = applyCoinbaseUserStreamMessage(recovered, {
    channel: 'heartbeats',
    sequence_num: 100,
    timestamp: '2026-07-17T10:00:05.000Z',
    events: [{ type: 'heartbeat' }],
  })
  const fresh = evaluateCoinbaseUserStreamFreshness(
    heartbeat.cursor,
    new Date('2026-07-17T10:00:10.000Z'),
  )

  assert.equal(heartbeat.cursor.lastSequence, 30)
  assert.equal(heartbeat.cursor.lastHeartbeatAt, '2026-07-17T10:00:05.000Z')
  assert.deepEqual(fresh, { healthy: true, reasons: [] })
})

test('stale streams fail freshness checks', () => {
  const recovered = recoverCoinbaseUserStreamCursor(
    40,
    '2026-07-17T10:00:00.000Z',
  )
  const freshness = evaluateCoinbaseUserStreamFreshness(
    recovered,
    new Date('2026-07-17T10:02:00.000Z'),
    { maxMessageAgeMs: 30_000, maxHeartbeatAgeMs: 30_000 },
  )

  assert.equal(freshness.healthy, false)
  assert.ok(freshness.reasons.includes('user_stream_message_stale'))
  assert.ok(freshness.reasons.includes('user_stream_heartbeat_missing'))
})
