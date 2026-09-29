import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateBitgetCandidateGateChain,
  type BitgetCandidateGateChainInput,
} from '../src/live/bitget-candidate-gate-chain.ts'
import type {
  AuthorizationRequest,
  ScopedRole,
  StepUpSession,
} from '../src/live/authorization.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import type { GuardianScopeState } from '../src/live/guardian.ts'
import type { ProductRules } from '../src/live/domain.ts'

const now = '2026-09-29T08:00:00.000Z'

function role(value: ScopedRole['role']): ScopedRole {
  return {
    role: value,
    scopeType: 'ACCOUNT',
    scopeKey: 'bitget-account-ref',
    expiresAt: null,
    revokedAt: null,
  }
}

function stepUp(actorId = 'operator-123'): StepUpSession {
  return {
    stepUpSessionId: 'step-up-trading-1',
    actorId,
    assuranceLevel: 'AAL2',
    audience: 'trading',
    issuedAt: '2026-09-29T07:55:00.000Z',
    expiresAt: '2026-09-29T08:05:00.000Z',
    revokedAt: null,
  }
}

function authorization(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    actorId: 'operator-123',
    action: 'CREATE_ORDER',
    resourceType: 'ORDER',
    resourceId: 'order-gate-1',
    exchangeName: 'BITGET',
    exchangeAccountId: 'bitget-account-ref',
    resourceOwnerActorId: null,
    roles: [role('TRADER')],
    stepUpSession: stepUp(),
    evaluatedAt: now,
    ...overrides,
  }
}

function guardian(status: GuardianScopeState['status'] = 'CLEAR'): GuardianScopeState[] {
  return [{
    scopeType: 'ACCOUNT',
    scopeKey: 'bitget-account-ref',
    status,
    reasonCode: status === 'CLEAR' ? null : 'OPERATOR_HALT',
    reasonDetail: null,
    version: 1,
    updatedAt: now,
  }]
}

function productRules(): ProductRules {
  return {
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    baseIncrement: asDecimalString('0.00000001'),
    quoteIncrement: asDecimalString('0.01'),
    priceIncrement: asDecimalString('0.01'),
    minimumBaseSize: asDecimalString('0.0001'),
    maximumBaseSize: asDecimalString('10'),
    minimumQuoteSize: asDecimalString('5'),
    tradingEnabled: true,
    supportedOrderTypes: ['MARKET', 'LIMIT'],
    observedAt: '2026-09-29T07:59:00.000Z',
    expiresAt: '2026-09-29T08:10:00.000Z',
  }
}

function input(overrides: Partial<BitgetCandidateGateChainInput> = {}): BitgetCandidateGateChainInput {
  return {
    authorization: authorization(),
    guardianStates: guardian(),
    command: {
      orderId: 'order-gate-1',
      exchangeAccountId: 'bitget-account-ref',
      correlationId: 'correlation-gate-1',
      idempotencyKey: 'order:gate:0001',
      configurationVersion: 'risk-config-v1',
      riskDecisionId: 'risk-gate-1',
      decidedAt: now,
      reservationJournalId: 'reservation-gate-1',
      request: {
        productId: 'BTC-USDT',
        side: 'BUY',
        orderType: 'MARKET',
        baseQuantity: null,
        quoteNotional: asDecimalString('100'),
        limitPrice: null,
        stopPrice: null,
      },
      previewOptions: {
        productRules: productRules(),
        referencePrice: {
          productId: 'BTC-USDT',
          price: asDecimalString('60000'),
          observedAt: '2026-09-29T07:59:30.000Z',
          expiresAt: '2026-09-29T08:02:00.000Z',
        },
        feeRate: asDecimalString('0.001'),
        slippageBps: 100,
        now: () => new Date(now),
      },
      risk: {
        dailyTradedNotional: asDecimalString('0'),
        currentPositionNotional: asDecimalString('0'),
        availableQuoteBalance: asDecimalString('1000'),
        availableBaseBalance: asDecimalString('1'),
        openOrderCount: 0,
        accountEligible: true,
        releaseActive: true,
        guardianClear: false,
        marketFeedFresh: true,
        productRulesFresh: true,
        reconciliationClear: true,
        idempotencyClaimed: true,
        limits: {
          maxOrderNotional: asDecimalString('200'),
          maxDailyNotional: asDecimalString('1000'),
          maxPositionNotional: asDecimalString('2000'),
          maxOpenOrders: 5,
        },
      },
      reservationAccounts: {
        availableAccountId: 'ledger:USDT:available',
        reservedAccountId: 'ledger:USDT:reserved',
      },
      clientOrderId: 'client-order-gate-1',
      force: 'gtc',
      candidateBuiltAt: now,
      candidateExpiresAt: '2026-09-29T08:01:00.000Z',
    },
    ...overrides,
  }
}

test('authorized clear Guardian path composes a locked provider candidate', async () => {
  const outcome = await evaluateBitgetCandidateGateChain(input())

  assert.equal(outcome.status, 'READY_BUT_EXECUTION_LOCKED')
  assert.equal(outcome.authorization.allowed, true)
  assert.equal(outcome.guardian.newOrdersAllowed, true)
  assert.ok(outcome.command?.providerCandidate)
  assert.equal(outcome.command?.executionAllowed, false)
  assert.equal(outcome.executionAllowed, false)
  assert.equal(outcome.providerMutationAllowed, false)
  assert.ok(outcome.reasons.includes('execution_locked'))
})

test('authorization denial stops before provider-candidate construction', async () => {
  const outcome = await evaluateBitgetCandidateGateChain(input({
    authorization: authorization({
      roles: [role('VIEWER')],
      stepUpSession: stepUp(),
    }),
  }))

  assert.equal(outcome.status, 'REJECTED_BY_AUTHORIZATION')
  assert.equal(outcome.command, null)
  assert.equal(outcome.executionAllowed, false)
  assert.ok(outcome.reasons.includes('authorization_denied'))
  assert.ok(outcome.reasons.includes('authorization:required_role_missing'))
})

test('Guardian halt stops before provider-candidate construction', async () => {
  const outcome = await evaluateBitgetCandidateGateChain(input({
    guardianStates: guardian('HALTED'),
  }))

  assert.equal(outcome.status, 'REJECTED_BY_GUARDIAN')
  assert.equal(outcome.command, null)
  assert.equal(outcome.executionAllowed, false)
  assert.ok(outcome.reasons.includes('guardian_new_orders_blocked'))
})

test('authorization identity must bind to the same order and account', async () => {
  await assert.rejects(
    evaluateBitgetCandidateGateChain(input({
      authorization: authorization({ resourceId: 'different-order' }),
    })),
    /resourceId must match command orderId/,
  )

  await assert.rejects(
    evaluateBitgetCandidateGateChain(input({
      authorization: authorization({ exchangeAccountId: 'different-account' }),
    })),
    /exchangeAccountId must match command exchangeAccountId/,
  )
})
