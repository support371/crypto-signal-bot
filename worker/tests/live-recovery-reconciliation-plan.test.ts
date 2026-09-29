import assert from 'node:assert/strict'
import test from 'node:test'

import { planRecoveryLookup } from '../src/live/recovery-reconciliation-plan.ts'
import type { LiveRecoveryCandidate } from '../src/live/recovery-scan.ts'

function candidate(overrides: Partial<LiveRecoveryCandidate> = {}): LiveRecoveryCandidate {
  return {
    internalOrderId: 'order-1',
    exchangeAccountId: 'account-1',
    exchangeOrderId: 'exchange-1',
    clientOrderId: 'client-1',
    productId: 'BTC-USDT',
    state: 'RECOVERY_REQUIRED',
    updatedAt: '2026-09-29T08:00:00.000Z',
    recoveryReason: 'EXPLICIT_RECOVERY_REQUIRED',
    ...overrides,
  }
}

test('recovery lookup prefers exchange order identity and is GET-only', () => {
  const plan = planRecoveryLookup(candidate())
  assert.equal(plan.status, 'LOOKUP_READY')
  assert.equal(plan.instruction?.lookupBy, 'EXCHANGE_ORDER_ID')
  assert.equal(plan.instruction?.lookupValue, 'exchange-1')
  assert.equal(plan.instruction?.method, 'GET')
  assert.equal(plan.instruction?.mutationAllowed, false)
  assert.equal(plan.automaticRetryAllowed, false)
})

test('recovery lookup falls back to client order identity after ambiguous submission', () => {
  const plan = planRecoveryLookup(candidate({ exchangeOrderId: null }))
  assert.equal(plan.status, 'LOOKUP_READY')
  assert.equal(plan.instruction?.lookupBy, 'CLIENT_ORDER_ID')
  assert.equal(plan.instruction?.lookupValue, 'client-1')
})

test('missing provider identities stops for review rather than retrying', () => {
  const plan = planRecoveryLookup(candidate({
    exchangeOrderId: null,
    clientOrderId: null,
  }))
  assert.equal(plan.status, 'MANUAL_REVIEW_REQUIRED')
  assert.equal(plan.instruction, null)
  assert.equal(plan.reason, 'provider_order_identity_missing')
  assert.equal(plan.providerMutationAllowed, false)
  assert.equal(plan.automaticRetryAllowed, false)
})
