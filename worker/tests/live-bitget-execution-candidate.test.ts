import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'
import type { CandidateOrderAssessmentInput } from '../src/live/candidate-command-plan.ts'
import {
  BitgetExecutionCandidateAdapter,
  buildBitgetCancelOrderCandidate,
  buildBitgetCancelReplaceOrderCandidate,
  buildBitgetPlaceOrderCandidate,
  classifyBitgetCandidateOutcome,
} from '../src/live/adapters/bitget/execution-candidate.ts'
import { buildBitgetLockedOrderCommand } from '../src/live/bitget-locked-order-command.ts'

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
    observedAt: '2026-07-17T14:00:00.000Z',
    expiresAt: '2026-07-17T14:10:00.000Z',
  }
}

function marketBuyRequest() {
  return {
    productId: 'BTC-USDT',
    side: 'BUY' as const,
    orderType: 'MARKET' as const,
    baseQuantity: null,
    quoteNotional: asDecimalString('100'),
    limitPrice: null,
    stopPrice: null,
  }
}

function placeInput() {
  return {
    request: marketBuyRequest(),
    productRules: productRules(),
    clientOrderId: 'candidate-order-0001',
    previewHash: 'a'.repeat(64),
    force: 'gtc' as const,
    builtAt: '2026-07-17T14:05:00.000Z',
    expiresAt: '2026-07-17T14:06:00.000Z',
  }
}

function assessmentInput(overrides: Partial<CandidateOrderAssessmentInput> = {}): CandidateOrderAssessmentInput {
  return {
    orderId: 'order-1',
    exchangeAccountId: 'bitget-account-ref',
    correlationId: 'correlation-1',
    idempotencyKey: 'order:locked:0001',
    configurationVersion: 'risk-config-v1',
    riskDecisionId: 'risk-decision-1',
    decidedAt: '2026-07-17T14:05:00.000Z',
    reservationJournalId: 'reservation-journal-1',
    request: marketBuyRequest(),
    previewOptions: {
      productRules: productRules(),
      referencePrice: {
        productId: 'BTC-USDT',
        price: asDecimalString('50000'),
        observedAt: '2026-07-17T14:04:00.000Z',
        expiresAt: '2026-07-17T14:06:00.000Z',
      },
      feeRate: asDecimalString('0.001'),
      slippageBps: 100,
      now: () => new Date('2026-07-17T14:05:00.000Z'),
    },
    risk: {
      dailyTradedNotional: asDecimalString('0'),
      currentPositionNotional: asDecimalString('0'),
      availableQuoteBalance: asDecimalString('1000'),
      availableBaseBalance: asDecimalString('1'),
      openOrderCount: 0,
      accountEligible: true,
      releaseActive: true,
      guardianClear: true,
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
    ...overrides,
  }
}

test('place candidate preserves market-buy quote sizing and permanent locks', async () => {
  const candidate = await buildBitgetPlaceOrderCandidate(placeInput())

  assert.equal(candidate.operation, 'PLACE')
  assert.equal(candidate.method, 'POST_EVIDENCE_ONLY')
  assert.equal(candidate.unsignedBody.symbol, 'BTCUSDT')
  assert.equal(candidate.unsignedBody.side, 'buy')
  assert.equal(candidate.unsignedBody.orderType, 'market')
  assert.equal(candidate.unsignedBody.size, '100')
  assert.equal(candidate.unsignedBody.clientOid, 'candidate-order-0001')
  assert.equal(candidate.providerMutationAllowed, false)
  assert.equal(candidate.executionAllowed, false)
  assert.equal(candidate.automaticRetryAllowed, false)
  assert.equal(candidate.transportSelected, false)
  assert.equal(candidate.signingMaterialPresent, false)
  assert.equal(candidate.recoveryLookups.length, 1)
  assert.equal(candidate.recoveryLookups[0]?.method, 'GET')
  assert.match(candidate.candidateHash, /^[a-f0-9]{64}$/)
})

test('place candidate hash is deterministic', async () => {
  const first = await buildBitgetPlaceOrderCandidate(placeInput())
  const second = await buildBitgetPlaceOrderCandidate(placeInput())
  assert.equal(first.candidateHash, second.candidateHash)
})

test('cancel candidate requires exactly one provider identity', async () => {
  const cancel = await buildBitgetCancelOrderCandidate({
    productId: 'BTC-USDT',
    identity: { orderId: null, clientOrderId: 'candidate-order-0001' },
    builtAt: '2026-07-17T14:05:00.000Z',
    expiresAt: '2026-07-17T14:06:00.000Z',
  })
  assert.equal(cancel.operation, 'CANCEL')
  assert.equal(cancel.unsignedBody.clientOid, 'candidate-order-0001')
  assert.equal(cancel.recoveryLookups.length, 1)

  await assert.rejects(
    buildBitgetCancelOrderCandidate({
      productId: 'BTC-USDT',
      identity: { orderId: 'provider-1', clientOrderId: 'candidate-order-0001' },
      builtAt: '2026-07-17T14:05:00.000Z',
      expiresAt: '2026-07-17T14:06:00.000Z',
    }),
    /exactly one/,
  )
})

test('cancel-replace candidate requires recovery for both identities', async () => {
  const candidate = await buildBitgetCancelReplaceOrderCandidate({
    productId: 'BTC-USDT',
    oldIdentity: { orderId: 'provider-order-1', clientOrderId: null },
    replacement: {
      ...placeInput(),
      clientOrderId: 'candidate-order-0002',
    },
    builtAt: '2026-07-17T14:05:00.000Z',
    expiresAt: '2026-07-17T14:06:00.000Z',
  })

  assert.equal(candidate.operation, 'CANCEL_REPLACE')
  assert.equal(candidate.recoveryLookups.length, 2)
  assert.ok(candidate.warnings.includes('split_outcome_requires_both_identity_lookups'))
  assert.equal(candidate.automaticRetryAllowed, false)
})

test('provider outcome classification never enables automatic retry', () => {
  const ambiguous = classifyBitgetCandidateOutcome({
    httpStatus: null,
    providerCode: null,
    providerMessage: null,
    transportError: 'TIMEOUT',
    expectedClientOrderId: 'candidate-order-0001',
    expectedExchangeOrderId: null,
    acknowledgedClientOrderId: null,
    acknowledgedExchangeOrderId: null,
  })
  assert.equal(ambiguous.category, 'AMBIGUOUS_REQUIRES_LOOKUP')
  assert.equal(ambiguous.recoveryRequired, true)
  assert.equal(ambiguous.automaticRetryAllowed, false)

  const duplicate = classifyBitgetCandidateOutcome({
    httpStatus: 400,
    providerCode: 'duplicate_client_oid',
    providerMessage: 'clientOid already exists',
    transportError: null,
    expectedClientOrderId: 'candidate-order-0001',
    expectedExchangeOrderId: null,
    acknowledgedClientOrderId: null,
    acknowledgedExchangeOrderId: null,
  })
  assert.equal(duplicate.category, 'DUPLICATE_CLIENT_ORDER_ID')
  assert.equal(duplicate.recoveryRequired, true)
  assert.equal(duplicate.automaticRetryAllowed, false)

  const acknowledged = classifyBitgetCandidateOutcome({
    httpStatus: 200,
    providerCode: '00000',
    providerMessage: 'success',
    transportError: null,
    expectedClientOrderId: 'candidate-order-0001',
    expectedExchangeOrderId: null,
    acknowledgedClientOrderId: 'candidate-order-0001',
    acknowledgedExchangeOrderId: 'provider-order-1',
  })
  assert.equal(acknowledged.category, 'ACKNOWLEDGED')
  assert.equal(acknowledged.providerAcknowledgmentVerified, true)
  assert.equal(acknowledged.automaticRetryAllowed, false)
})

test('locked command binds preview risk reservation and candidate hashes', async () => {
  const command = await buildBitgetLockedOrderCommand({
    ...assessmentInput(),
    clientOrderId: 'candidate-order-0001',
    force: 'gtc',
    candidateBuiltAt: '2026-07-17T14:05:00.000Z',
    candidateExpiresAt: '2026-07-17T14:06:00.000Z',
  })

  assert.equal(command.status, 'READY_BUT_EXECUTION_LOCKED')
  assert.ok(command.providerCandidate)
  assert.equal(command.providerCandidate?.unsignedBody.previewHash, command.assessment.preview.rawResponseHash)
  assert.equal(command.assessment.reservationJournalDraft?.journalId, 'reservation-journal-1')
  assert.equal(command.providerMutationAllowed, false)
  assert.equal(command.executionAllowed, false)
  assert.equal(command.automaticRetryAllowed, false)
  assert.equal(command.automaticallySubmitted, false)
  assert.match(command.commandHash, /^[a-f0-9]{64}$/)
})

test('rejected assessment builds no provider candidate', async () => {
  const base = assessmentInput()
  const command = await buildBitgetLockedOrderCommand({
    ...assessmentInput({
      risk: {
        ...base.risk,
        availableQuoteBalance: asDecimalString('50'),
      },
    }),
    clientOrderId: 'candidate-order-0001',
    force: 'gtc',
    candidateBuiltAt: '2026-07-17T14:05:00.000Z',
    candidateExpiresAt: '2026-07-17T14:06:00.000Z',
  })

  assert.equal(command.status, 'REJECTED')
  assert.equal(command.providerCandidate, null)
  assert.ok(command.reasons.includes('provider_candidate_not_built'))
})

test('candidate adapter permanently throws for every submission method', () => {
  const adapter = new BitgetExecutionCandidateAdapter()
  assert.throws(() => adapter.submitPlaceOrder(), /execution-locked/)
  assert.throws(() => adapter.submitCancelOrder(), /execution-locked/)
  assert.throws(() => adapter.submitCancelReplaceOrder(), /execution-locked/)
})
