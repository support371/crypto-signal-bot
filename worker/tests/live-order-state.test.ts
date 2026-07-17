import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertOrderTransition,
  canTransitionOrder,
  InvalidOrderTransition,
  isOrderExchangeActive,
  isOrderTerminal,
} from '../src/live/order-state-machine.ts'

test('order state machine permits only explicit lifecycle transitions', () => {
  assert.equal(canTransitionOrder('REQUESTED', 'VALIDATING'), true)
  assert.equal(canTransitionOrder('VALIDATED', 'SUBMITTING'), false)
  assert.equal(canTransitionOrder('SUBMITTED', 'PARTIALLY_FILLED'), true)
  assert.equal(canTransitionOrder('PARTIALLY_FILLED', 'FILLED'), true)
  assert.equal(canTransitionOrder('FILLED', 'SETTLED'), true)
})

test('illegal transitions fail closed', () => {
  assert.throws(
    () => assertOrderTransition('REQUESTED', 'FILLED'),
    (error: unknown) => {
      assert.ok(error instanceof InvalidOrderTransition)
      assert.equal(error.previousState, 'REQUESTED')
      assert.equal(error.requestedState, 'FILLED')
      return true
    },
  )
})

test('final outcomes are terminal while unresolved exchange states remain active', () => {
  for (const state of [
    'RISK_REJECTED',
    'PREVIEW_REJECTED',
    'FILLED',
    'CANCELLED',
    'REJECTED',
    'EXPIRED',
    'FAILED',
    'SETTLED',
  ] as const) {
    assert.equal(isOrderTerminal(state), true, `${state} should be terminal`)
  }

  for (const state of [
    'SUBMITTING',
    'SUBMITTED',
    'OPEN',
    'PARTIALLY_FILLED',
    'CANCEL_REQUESTED',
    'CANCEL_PENDING',
    'RECOVERY_REQUIRED',
  ] as const) {
    assert.equal(isOrderExchangeActive(state), true, `${state} should be exchange-active`)
  }
})
