import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateRecoveryAccountingApproval,
  type RecoveryAccountingApprovalInput,
} from '../src/live/recovery-accounting-approval.ts'
import type { BitgetRecoveryAccountingPlan } from '../src/live/bitget-recovery-accounting-plan.ts'
import type { ScopedRole, StepUpSession } from '../src/live/authorization.ts'
import { asDecimalString } from '../src/live/decimal.ts'

function role(
  value: ScopedRole['role'],
  scopeKey = 'bitget-account-ref',
): ScopedRole {
  return {
    role: value,
    scopeType: 'ACCOUNT',
    scopeKey,
    expiresAt: null,
    revokedAt: null,
  }
}

function stepUp(actorId: string, audience = 'operations'): StepUpSession {
  return {
    stepUpSessionId: `step-up-${actorId}-${audience}`,
    actorId,
    assuranceLevel: 'AAL2',
    audience,
    issuedAt: '2026-07-17T21:55:00.000Z',
    expiresAt: '2026-07-17T22:05:00.000Z',
    revokedAt: null,
  }
}

function plan(overrides: Partial<BitgetRecoveryAccountingPlan> = {}): BitgetRecoveryAccountingPlan {
  return {
    exchangeName: 'BITGET',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoverySnapshotHash: 'a'.repeat(64),
    commandCount: 1,
    commands: [{
      exchangeName: 'BITGET',
      exchangeAccountId: 'bitget-account-ref',
      internalOrderId: 'internal-order-1',
      correlationId: 'correlation-1',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      fill: {
        fillId: 'fill-1',
        tradeId: 'trade-1',
        exchangeOrderId: 'exchange-order-1',
        productId: 'BTC-USDT',
        side: 'BUY',
        price: asDecimalString('50000'),
        baseSize: asDecimalString('0.01'),
        commission: asDecimalString('0'),
        commissionAsset: null,
        tradeTime: '2026-07-17T22:00:00.000Z',
        sequenceTimestamp: '2026-07-17T22:00:01.000Z',
      },
      feeQuoteValue: null,
      accounts: {
        baseInventoryAccountId: 'ledger:BTC:inventory',
        baseReservedAccountId: 'ledger:BTC:reserved',
        baseClearingAccountId: 'ledger:BTC:clearing',
        quoteAvailableAccountId: 'ledger:USDT:available',
        quoteReservedAccountId: 'ledger:USDT:reserved',
        quoteClearingAccountId: 'ledger:USDT:clearing',
        feeExpenseAccountId: null,
        feeSourceAccountId: null,
      },
      rawResponseHash: 'b'.repeat(64),
    }],
    planHash: 'c'.repeat(64),
    accountingEvidenceReady: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
    ...overrides,
  }
}

function input(
  overrides: Partial<RecoveryAccountingApprovalInput> = {},
): RecoveryAccountingApprovalInput {
  return {
    approvalEventId: 'recovery-approval-1',
    authorizationEventId: 'authorization-recovery-approval-1',
    planId: 'recovery-plan-1',
    plan: plan(),
    planPreparedByActorId: 'recovery-planner-1',
    actorId: 'risk-operator-1',
    roles: [role('RISK_OPERATOR')],
    stepUpSession: stepUp('risk-operator-1'),
    correlationId: 'correlation-recovery-approval-1',
    auditEventHash: 'd'.repeat(64),
    evaluatedAt: '2026-07-17T22:00:00.000Z',
    ...overrides,
  }
}

test('independent scoped risk operator with operations step-up may approve', async () => {
  const decision = await evaluateRecoveryAccountingApproval(input())

  assert.equal(decision.approved, true)
  assert.deepEqual(decision.reasons, [])
  assert.equal(decision.authorizationDecision.allowed, true)
  assert.ok(decision.authorizationDecision.matchedRoles.includes('RISK_OPERATOR'))
  assert.match(decision.approvalHash, /^[a-f0-9]{64}$/)
  assert.equal(decision.automaticallyDispatched, false)
  assert.equal(decision.providerMutationAllowed, false)
  assert.equal(decision.reservationApplied, false)
  assert.equal(decision.executionAllowed, false)
})

test('risk admin may approve with the same independent step-up requirements', async () => {
  const decision = await evaluateRecoveryAccountingApproval(input({
    roles: [role('RISK_ADMIN')],
  }))

  assert.equal(decision.approved, true)
  assert.ok(decision.authorizationDecision.matchedRoles.includes('RISK_ADMIN'))
})

test('auditor and viewer roles cannot approve accounting dispatch eligibility', async () => {
  for (const value of ['AUDITOR', 'VIEWER'] as const) {
    const decision = await evaluateRecoveryAccountingApproval(input({
      roles: [role(value)],
    }))
    assert.equal(decision.approved, false)
    assert.ok(decision.reasons.includes('risk_approval_role_required'))
  }
})

test('plan preparer cannot approve their own recovery accounting plan', async () => {
  const decision = await evaluateRecoveryAccountingApproval(input({
    actorId: 'recovery-planner-1',
    roles: [role('RISK_ADMIN')],
    stepUpSession: stepUp('recovery-planner-1'),
  }))

  assert.equal(decision.approved, false)
  assert.ok(decision.reasons.includes('plan_preparer_cannot_approve'))
})

test('wrong account scope, missing step-up, and wrong audience fail closed', async () => {
  const wrongScope = await evaluateRecoveryAccountingApproval(input({
    roles: [role('RISK_OPERATOR', 'other-account')],
  }))
  const missingStepUp = await evaluateRecoveryAccountingApproval(input({
    stepUpSession: null,
  }))
  const wrongAudience = await evaluateRecoveryAccountingApproval(input({
    stepUpSession: stepUp('risk-operator-1', 'risk'),
  }))

  assert.equal(wrongScope.approved, false)
  assert.ok(wrongScope.reasons.includes('required_role_missing'))
  assert.equal(missingStepUp.approved, false)
  assert.ok(missingStepUp.reasons.includes('valid_step_up_session_missing'))
  assert.equal(wrongAudience.approved, false)
  assert.ok(wrongAudience.reasons.includes('valid_step_up_session_missing'))
})

test('approval hash is deterministic for identical evidence', async () => {
  const first = await evaluateRecoveryAccountingApproval(input())
  const second = await evaluateRecoveryAccountingApproval(input())
  assert.equal(first.approvalHash, second.approvalHash)
})

test('plan boundary violations fail before authorization', async () => {
  await assert.rejects(
    evaluateRecoveryAccountingApproval(input({
      plan: plan({ automaticallyDispatched: true as false }),
    })),
    /violates the non-execution boundary/,
  )
  await assert.rejects(
    evaluateRecoveryAccountingApproval(input({
      plan: plan({ commandCount: 2 }),
    })),
    /command count is inconsistent/,
  )
})

test('approval never grants trading execution even when approved', async () => {
  const decision = await evaluateRecoveryAccountingApproval(input())
  assert.equal(decision.approved, true)
  assert.equal(decision.automaticallyDispatched, false)
  assert.equal(decision.providerMutationAllowed, false)
  assert.equal(decision.reservationApplied, false)
  assert.equal(decision.executionAllowed, false)
})
