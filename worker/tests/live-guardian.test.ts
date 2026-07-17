import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateGuardianHierarchy,
  type GuardianScopeState,
} from '../src/live/guardian.ts'

function state(
  scopeType: GuardianScopeState['scopeType'],
  scopeKey: string,
  status: GuardianScopeState['status'],
  reasonCode: string | null = null,
): GuardianScopeState {
  return {
    scopeType,
    scopeKey,
    status,
    reasonCode,
    reasonDetail: null,
    version: 1,
    updatedAt: '2026-07-17T10:00:00.000Z',
  }
}

test('clear Guardian hierarchy permits normal operations', () => {
  const decision = evaluateGuardianHierarchy([
    state('GLOBAL', 'global', 'CLEAR'),
    state('ACCOUNT', 'account-ref-hash', 'CLEAR'),
    state('WITHDRAWALS', 'account-ref-hash', 'CLEAR'),
  ])

  assert.equal(decision.status, 'CLEAR')
  assert.equal(decision.newOrdersAllowed, true)
  assert.equal(decision.cancelsAllowed, true)
  assert.equal(decision.closeOnlyAllowed, true)
  assert.equal(decision.withdrawalsAllowed, true)
})

test('strategy restriction blocks new orders but preserves close-only controls', () => {
  const decision = evaluateGuardianHierarchy([
    state('GLOBAL', 'global', 'CLEAR'),
    state('STRATEGY', 'ema-crossover', 'RESTRICTED', 'STRATEGY_ERROR_RATE'),
  ])

  assert.equal(decision.status, 'RESTRICTED')
  assert.equal(decision.newOrdersAllowed, false)
  assert.equal(decision.cancelsAllowed, true)
  assert.equal(decision.closeOnlyAllowed, true)
  assert.equal(decision.withdrawalsAllowed, false)
  assert.deepEqual(decision.reasons, [
    'STRATEGY:ema-crossover:STRATEGY_ERROR_RATE',
  ])
})

test('account halt blocks new and close-only orders but still permits cancellation', () => {
  const decision = evaluateGuardianHierarchy([
    state('SYMBOL', 'BTC-USD', 'RESTRICTED', 'MARKET_FEED_STALE'),
    state('ACCOUNT', 'account-ref-hash', 'HALTED', 'RECONCILIATION_DRIFT'),
  ])

  assert.equal(decision.status, 'HALTED')
  assert.equal(decision.newOrdersAllowed, false)
  assert.equal(decision.cancelsAllowed, true)
  assert.equal(decision.closeOnlyAllowed, false)
  assert.equal(decision.withdrawalsAllowed, false)
  assert.equal(decision.blockedScopes[0].scopeType, 'ACCOUNT')
})

test('withdrawal-specific restriction cannot block order cancellation', () => {
  const decision = evaluateGuardianHierarchy([
    state('WITHDRAWALS', 'account-ref-hash', 'RESTRICTED', 'WITHDRAWAL_ANOMALY'),
  ])

  assert.equal(decision.newOrdersAllowed, false)
  assert.equal(decision.cancelsAllowed, true)
  assert.equal(decision.closeOnlyAllowed, true)
  assert.equal(decision.withdrawalsAllowed, false)
})
