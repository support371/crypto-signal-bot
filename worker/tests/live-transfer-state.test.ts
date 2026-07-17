import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertDepositTransition,
  assertWithdrawalTransition,
  canTransitionDeposit,
  canTransitionWithdrawal,
  InvalidDepositTransition,
  InvalidWithdrawalTransition,
  isDepositTerminal,
  isWithdrawalProviderActive,
  isWithdrawalTerminal,
} from '../src/live/transfer-state.ts'

test('deposit lifecycle requires explicit provider-observation transitions', () => {
  assert.equal(canTransitionDeposit('DETECTED', 'PENDING'), true)
  assert.equal(canTransitionDeposit('PENDING', 'CONFIRMING'), true)
  assert.equal(canTransitionDeposit('CONFIRMING', 'COMPLETED'), true)
  assert.equal(canTransitionDeposit('DETECTED', 'REVERSED'), false)
})

test('illegal deposit transitions fail closed', () => {
  assert.throws(
    () => assertDepositTransition('PENDING', 'REVERSED'),
    (error: unknown) => {
      assert.ok(error instanceof InvalidDepositTransition)
      assert.equal(error.previousState, 'PENDING')
      assert.equal(error.requestedState, 'REVERSED')
      return true
    },
  )
})

test('withdrawal lifecycle enforces screening, approval, lock, and preview ordering', () => {
  assert.equal(canTransitionWithdrawal('REQUESTED', 'SCREENING'), true)
  assert.equal(canTransitionWithdrawal('SCREENING', 'PENDING_APPROVAL'), true)
  assert.equal(canTransitionWithdrawal('PENDING_APPROVAL', 'APPROVED'), true)
  assert.equal(canTransitionWithdrawal('APPROVED', 'TIME_LOCKED'), true)
  assert.equal(canTransitionWithdrawal('TIME_LOCKED', 'PREVIEWING'), true)
  assert.equal(canTransitionWithdrawal('PREVIEWING', 'SUBMITTING'), true)
  assert.equal(canTransitionWithdrawal('REQUESTED', 'SUBMITTING'), false)
})

test('illegal withdrawal transitions fail closed', () => {
  assert.throws(
    () => assertWithdrawalTransition('REQUESTED', 'COMPLETED'),
    (error: unknown) => {
      assert.ok(error instanceof InvalidWithdrawalTransition)
      assert.equal(error.previousState, 'REQUESTED')
      assert.equal(error.requestedState, 'COMPLETED')
      return true
    },
  )
})

test('terminal and provider-active transfer states are classified correctly', () => {
  for (const state of ['COMPLETED', 'FAILED', 'REVERSED'] as const) {
    assert.equal(isDepositTerminal(state), true)
  }
  for (const state of ['REJECTED', 'COMPLETED', 'CANCELLED', 'FAILED'] as const) {
    assert.equal(isWithdrawalTerminal(state), true)
  }
  for (const state of ['SUBMITTING', 'SUBMITTED', 'CONFIRMING', 'RECOVERY_REQUIRED'] as const) {
    assert.equal(isWithdrawalProviderActive(state), true)
  }
})
