import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyBitgetUserStreamMessage,
  evaluateBitgetUserStreamFreshness,
  initialBitgetUserStreamCursor,
  markBitgetUserStreamConnected,
  markBitgetUserStreamDisconnected,
  recoverBitgetUserStreamCursor,
  type BitgetUserStreamCursor,
} from '../src/live/adapters/bitget/user-stream.ts'

function subscribedCursor(): BitgetUserStreamCursor {
  let cursor = markBitgetUserStreamConnected(
    initialBitgetUserStreamCursor(),
    '2026-07-17T22:00:00.000Z',
  )
  cursor = applyBitgetUserStreamMessage(cursor, {
    event: 'subscribe',
    code: '0',
    arg: { instType: 'SPOT', channel: 'orders', instId: 'default' },
  }, '2026-07-17T22:00:01.000Z').cursor
  cursor = applyBitgetUserStreamMessage(cursor, {
    event: 'subscribe',
    code: '0',
    arg: { instType: 'SPOT', channel: 'fill', instId: 'default' },
  }, '2026-07-17T22:00:02.000Z').cursor
  return cursor
}

function recoveredCursor(): BitgetUserStreamCursor {
  return recoverBitgetUserStreamCursor(subscribedCursor(), {
    orders: [],
    fills: [],
    snapshotAt: '2026-07-17T22:00:03.000Z',
    serverTimestampMs: 1784325603000,
  })
}

function orderMessage(ts = 1784325604000) {
  return {
    action: 'update',
    arg: { instType: 'SPOT', channel: 'orders', instId: 'BTCUSDT' },
    data: [{
      instId: 'BTCUSDT',
      orderId: 'order-1',
      clientOid: 'client-1',
      newSize: '0.01',
      orderType: 'limit',
      side: 'buy',
      accBaseVolume: '0.002',
      priceAvg: '50000',
      status: 'partially_filled',
      feeDetail: [{ feeCoin: 'USDT', fee: '-0.1' }],
      cTime: '1784325600000',
      uTime: '1784325604000',
    }],
    ts,
  }
}

function fillMessage(price = '50000', ts = 1784325605000) {
  return {
    action: 'snapshot',
    arg: { instType: 'SPOT', channel: 'fill', instId: 'default' },
    data: [{
      orderId: 'order-1',
      tradeId: 'trade-1',
      symbol: 'BTCUSDT',
      orderType: 'limit',
      side: 'buy',
      priceAvg: price,
      size: '0.002',
      feeDetail: [{ feeCoin: 'USDT', totalFee: '0.1' }],
      cTime: '1784325604500',
      uTime: '1784325604500',
    }],
    ts,
  }
}

test('connect and subscriptions remain blocked until REST recovery completes', () => {
  const cursor = subscribedCursor()
  assert.equal(cursor.connected, true)
  assert.equal(cursor.ordersSubscribed, true)
  assert.equal(cursor.fillsSubscribed, true)
  assert.equal(cursor.initialized, false)
  assert.equal(cursor.recoveryRequired, true)
  assert.equal(cursor.recoveryReason, 'rest_snapshot_required_after_connect')

  const decision = applyBitgetUserStreamMessage(
    cursor,
    orderMessage(),
    '2026-07-17T22:00:04.100Z',
  )
  assert.equal(decision.action, 'REST_SNAPSHOT_REQUIRED')
  assert.equal(decision.orders.length, 0)
})

test('recovered cursor applies normalized order and fill updates', () => {
  const orderDecision = applyBitgetUserStreamMessage(
    recoveredCursor(),
    orderMessage(),
    '2026-07-17T22:00:04.100Z',
  )
  assert.equal(orderDecision.action, 'APPLY')
  assert.equal(orderDecision.orders.length, 1)
  assert.equal(orderDecision.orders[0]?.productId, 'BTC-USDT')
  assert.equal(orderDecision.orders[0]?.requestedBaseQuantity, '0.01')
  assert.equal(orderDecision.orders[0]?.filledBaseQuantity, '0.002')
  assert.equal(orderDecision.orders[0]?.remainingBaseQuantity, '0.008')
  assert.equal(orderDecision.orders[0]?.totalFees, '0.1')

  const fillDecision = applyBitgetUserStreamMessage(
    orderDecision.cursor,
    fillMessage(),
    '2026-07-17T22:00:05.100Z',
  )
  assert.equal(fillDecision.action, 'APPLY')
  assert.equal(fillDecision.fills.length, 1)
  assert.equal(fillDecision.fills[0]?.fillId, 'trade-1')
  assert.equal(fillDecision.fills[0]?.commission, '0.1')
  assert.equal(fillDecision.fills[0]?.commissionAsset, 'USDT')
})

test('identical stream identity is ignored and conflicting identity requires REST recovery', () => {
  const first = applyBitgetUserStreamMessage(
    recoveredCursor(),
    fillMessage(),
    '2026-07-17T22:00:05.100Z',
  )
  const duplicate = applyBitgetUserStreamMessage(
    first.cursor,
    fillMessage(),
    '2026-07-17T22:00:06.100Z',
  )
  assert.equal(duplicate.action, 'IGNORE_DUPLICATE')
  assert.equal(duplicate.reason, 'duplicate_stream_event')

  const conflict = applyBitgetUserStreamMessage(
    duplicate.cursor,
    fillMessage('50001', 1784325607000),
    '2026-07-17T22:00:07.100Z',
  )
  assert.equal(conflict.action, 'REST_SNAPSHOT_REQUIRED')
  assert.match(conflict.reason ?? '', /^conflicting_stream_identity:fill:trade-1$/)
})

test('server timestamp regression fails closed', () => {
  const first = applyBitgetUserStreamMessage(
    recoveredCursor(),
    orderMessage(),
    '2026-07-17T22:00:04.100Z',
  )
  const regression = applyBitgetUserStreamMessage(
    first.cursor,
    fillMessage('50000', 1784325603999),
    '2026-07-17T22:00:05.100Z',
  )
  assert.equal(regression.action, 'REST_SNAPSHOT_REQUIRED')
  assert.equal(regression.reason, 'server_timestamp_regression')
})

test('multiple fee assets in one event require explicit REST recovery', () => {
  const message = fillMessage()
  message.data[0].feeDetail = [
    { feeCoin: 'USDT', totalFee: '0.1' },
    { feeCoin: 'BGB', totalFee: '0.01' },
  ]
  const decision = applyBitgetUserStreamMessage(
    recoveredCursor(),
    message,
    '2026-07-17T22:00:05.100Z',
  )
  assert.equal(decision.action, 'REST_SNAPSHOT_REQUIRED')
  assert.match(decision.reason ?? '', /multiple fee assets/)
})

test('pong freshness is tracked and disconnect always requires recovery', () => {
  const pong = applyBitgetUserStreamMessage(
    recoveredCursor(),
    'pong',
    '2026-07-17T22:00:10.000Z',
  )
  const healthy = evaluateBitgetUserStreamFreshness(
    pong.cursor,
    new Date('2026-07-17T22:00:20.000Z'),
  )
  assert.deepEqual(healthy, { healthy: true, reasons: [] })

  const stale = evaluateBitgetUserStreamFreshness(
    pong.cursor,
    new Date('2026-07-17T22:01:00.000Z'),
  )
  assert.equal(stale.healthy, false)
  assert.ok(stale.reasons.includes('bitget_stream_message_stale'))
  assert.ok(stale.reasons.includes('bitget_stream_pong_stale'))

  const disconnected = markBitgetUserStreamDisconnected(
    pong.cursor,
    '2026-07-17T22:01:01.000Z',
  )
  assert.equal(disconnected.connected, false)
  assert.equal(disconnected.recoveryRequired, true)
  assert.equal(disconnected.recoveryReason, 'websocket_disconnected')
})
