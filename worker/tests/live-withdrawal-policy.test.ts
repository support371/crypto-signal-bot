import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import {
  evaluateWithdrawalPolicy,
  type WithdrawalPolicyInput,
} from '../src/live/withdrawal-policy.ts'

const base: WithdrawalPolicyInput = {
  withdrawalId: 'withdrawal-1',
  exchangeAccountId: 'account-ref-hash',
  requesterId: 'requester-1',
  asset: 'USDC',
  network: 'BASE',
  amount: asDecimalString('100'),
  estimatedFee: asDecimalString('1'),
  availableBalance: asDecimalString('500'),
  dailyCompletedAmount: asDecimalString('50'),
  requestedAt: '2026-07-17T09:00:00.000Z',
  evaluatedAt: '2026-07-17T10:00:00.000Z',
  releaseAt: '2026-07-17T09:30:00.000Z',
  destination: {
    destinationId: 'destination-1',
    exchangeAccountId: 'account-ref-hash',
    asset: 'USDC',
    network: 'BASE',
    status: 'ACTIVE',
    screeningStatus: 'CLEAR',
    activatesAt: '2026-07-16T10:00:00.000Z',
    expiresAt: null,
  },
  approvals: [
    {
      approverId: 'approver-1',
      approvalRole: 'WITHDRAWAL_APPROVER',
      decision: 'APPROVE',
      decidedAt: '2026-07-17T09:10:00.000Z',
      stepUpValid: true,
    },
    {
      approverId: 'risk-admin-1',
      approvalRole: 'RISK_ADMIN',
      decision: 'APPROVE',
      decidedAt: '2026-07-17T09:12:00.000Z',
      stepUpValid: true,
    },
  ],
  accountEligible: true,
  releaseActive: true,
  guardianClear: true,
  reconciliationClear: true,
  idempotencyClaimed: true,
  providerCapabilityConfirmed: true,
  withdrawalsEnabled: true,
  candidateBuildLocked: false,
  limits: {
    minimumAmount: asDecimalString('10'),
    maximumAmount: asDecimalString('1000'),
    maximumDailyAmount: asDecimalString('2000'),
    requiredApprovalCount: 2,
    requiredApprovalRoles: ['WITHDRAWAL_APPROVER', 'RISK_ADMIN'],
    minimumTimeLockMs: 30 * 60 * 1000,
  },
}

test('complete withdrawal evidence can satisfy the pure policy', () => {
  const decision = evaluateWithdrawalPolicy(base)

  assert.equal(decision.allowed, true)
  assert.deepEqual(decision.reasons, [])
  assert.equal(decision.requiredBalance, '101')
  assert.equal(decision.projectedDailyAmount, '150')
  assert.deepEqual(decision.distinctApprovers, ['approver-1', 'risk-admin-1'])
})

test('disabled candidate build always blocks withdrawals', () => {
  const decision = evaluateWithdrawalPolicy({
    ...base,
    withdrawalsEnabled: false,
    candidateBuildLocked: true,
  })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('candidate_build_unlocked'))
  assert.ok(decision.reasons.includes('withdrawals_enabled'))
})

test('requester self-approval and missing role separation are rejected', () => {
  const decision = evaluateWithdrawalPolicy({
    ...base,
    approvals: [
      {
        approverId: 'requester-1',
        approvalRole: 'WITHDRAWAL_APPROVER',
        decision: 'APPROVE',
        decidedAt: '2026-07-17T09:10:00.000Z',
        stepUpValid: true,
      },
      {
        approverId: 'approver-2',
        approvalRole: 'WITHDRAWAL_APPROVER',
        decision: 'APPROVE',
        decidedAt: '2026-07-17T09:12:00.000Z',
        stepUpValid: true,
      },
    ],
  })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('requester_did_not_self_approve'))
  assert.ok(decision.reasons.includes('required_approval_roles_present'))
})

test('blocked, mismatched, or immature destinations fail closed', () => {
  const decision = evaluateWithdrawalPolicy({
    ...base,
    destination: {
      ...base.destination!,
      asset: 'BTC',
      screeningStatus: 'BLOCKED',
      activatesAt: '2026-07-18T10:00:00.000Z',
    },
  })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('destination_matches_request'))
  assert.ok(decision.reasons.includes('destination_active_and_screened'))
})

test('time lock, available balance, and rolling limit are independently enforced', () => {
  const decision = evaluateWithdrawalPolicy({
    ...base,
    availableBalance: asDecimalString('100'),
    dailyCompletedAmount: asDecimalString('1950'),
    releaseAt: '2026-07-17T09:10:00.000Z',
  })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('available_balance_sufficient'))
  assert.ok(decision.reasons.includes('projected_daily_amount_within_limit'))
  assert.ok(decision.reasons.includes('time_lock_satisfied'))
})

test('any explicit rejection prevents withdrawal submission', () => {
  const decision = evaluateWithdrawalPolicy({
    ...base,
    approvals: [
      ...base.approvals,
      {
        approverId: 'approver-3',
        approvalRole: 'WITHDRAWAL_APPROVER',
        decision: 'REJECT',
        decidedAt: '2026-07-17T09:15:00.000Z',
        stepUpValid: true,
      },
    ],
  })

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('no_rejection_present'))
})
