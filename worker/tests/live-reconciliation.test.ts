import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import { reconcileOrderObservation } from '../src/live/reconciliation.ts'

const now = new Date('2026-07-17T10:10:00.000Z')

test('full fills finalize without creating any retry action', () => {
  const decision = reconcileOrderObservation({
    id: 'exchange-order-1',
    status: 'closed',
    filled: '0.01',
    remaining: '0',
    average: '100000.25',
    observedAt: '2026-07-17T10:09:59.000Z',
  }, asDecimalString('0.01'), { now })

  assert.equal(decision.state, 'FILLED')
  assert.equal(decision.action, 'FINALIZE')
  assert.equal(decision.terminal, true)
  assert.equal(decision.requiresReview, false)
})

test('active partial fills wait and preserve exact remaining quantity', () => {
  const decision = reconcileOrderObservation({
    id: 'exchange-order-2',
    status: 'partially_filled',
    filled: '0.003',
    remaining: '0.007',
    average: '100000.25',
    observedAt: '2026-07-17T10:09:59.000Z',
  }, asDecimalString('0.01'), { now })

  assert.equal(decision.state, 'PARTIALLY_FILLED')
  assert.equal(decision.action, 'WAIT')
  assert.equal(decision.remainingQuantity, '0.007')
  assert.equal(decision.terminal, false)
})

test('terminal partial fills finalize only the executed quantity', () => {
  const decision = reconcileOrderObservation({
    id: 'exchange-order-3',
    status: 'cancelled',
    filled: '0.003',
    remaining: '0.007',
    average: '100000.25',
    observedAt: '2026-07-17T10:09:59.000Z',
  }, asDecimalString('0.01'), { now })

  assert.equal(decision.state, 'PARTIALLY_FILLED')
  assert.equal(decision.action, 'FINALIZE_PARTIAL')
  assert.equal(decision.terminal, true)
  assert.equal(decision.reason, 'terminal_partial_fill')
})

test('stale active orders halt for review instead of being retried', () => {
  const decision = reconcileOrderObservation({
    id: 'exchange-order-4',
    status: 'open',
    filled: '0',
    remaining: '0.01',
    observedAt: '2026-07-17T10:00:00.000Z',
  }, asDecimalString('0.01'), {
    now,
    staleAfterMs: 300_000,
  })

  assert.equal(decision.state, 'RECOVERY_REQUIRED')
  assert.equal(decision.action, 'HALT_FOR_REVIEW')
  assert.equal(decision.reason, 'stale_open_order')
})

test('inconsistent exchange quantities halt reconciliation', () => {
  const decision = reconcileOrderObservation({
    id: 'exchange-order-5',
    status: 'open',
    filled: '0.003',
    remaining: '0.008',
    observedAt: '2026-07-17T10:09:59.000Z',
  }, asDecimalString('0.01'), { now })

  assert.equal(decision.state, 'RECOVERY_REQUIRED')
  assert.equal(decision.action, 'HALT_FOR_REVIEW')
  assert.equal(decision.reason, 'remaining_quantity_inconsistent')
})

test('missing exchange order IDs never permit an assumed retry', () => {
  const decision = reconcileOrderObservation({
    status: 'open',
    filled: '0',
    remaining: '0.01',
    observedAt: '2026-07-17T10:09:59.000Z',
  }, asDecimalString('0.01'), { now })

  assert.equal(decision.state, 'RECOVERY_REQUIRED')
  assert.equal(decision.action, 'HALT_FOR_REVIEW')
  assert.equal(decision.reason, 'exchange_order_id_missing')
})
