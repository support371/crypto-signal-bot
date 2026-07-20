import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessBitgetCandidateOrder,
  type CandidateOrderAssessmentInput,
} from '../src/live/candidate-command-plan.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'

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

function input(overrides: Partial<CandidateOrderAssessmentInput> = {}): CandidateOrderAssessmentInput {
  return {
    orderId: 'order-1',
    exchangeAccountId: 'bitget-account-ref',
    correlationId: 'correlation-1',
    idempotencyKey: 'order:locked:0001',
    configurationVersion: 'risk-config-v1',
    riskDecisionId: 'risk-decision-1',
    decidedAt: '2026-07-17T14:05:00.000Z',
    reservationJournalId: 'reservation-journal-1',
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

test('passing operational evidence ends ready but execution-locked', async () => {
  const assessment = await assessBitgetCandidateOrder(input())

  assert.equal(assessment.status, 'READY_BUT_EXECUTION_LOCKED')
  assert.equal(assessment.operationalChecksPassed, true)
  assert.equal(assessment.executionAllowed, false)
  assert.equal(assessment.preview.accepted, true)
  assert.equal(assessment.riskDecision?.approved, false)
  assert.equal(
    assessment.riskDecision?.rules.find((rule) => rule.rule === 'execution_unlocked')?.reason,
    'execution_locked',
  )
  assert.ok(assessment.reasons.includes('execution_locked'))
  assert.match(assessment.evidenceHash, /^[a-f0-9]{64}$/)

  const journal = assessment.reservationJournalDraft
  assert.ok(journal)
  assert.equal(journal.eventType, 'FUNDS_RESERVED')
  assert.equal(journal.entries.length, 2)
  assert.equal(journal.entries[0]?.asset, 'USDT')
  assert.equal(journal.entries[0]?.amount, '100.1')
  assert.equal(journal.entries[1]?.amount, '100.1')
})

test('insufficient balance rejects assessment and creates no reservation draft', async () => {
  const assessment = await assessBitgetCandidateOrder(input({
    risk: {
      ...input().risk,
      availableQuoteBalance: asDecimalString('50'),
    },
  }))

  assert.equal(assessment.status, 'REJECTED')
  assert.equal(assessment.operationalChecksPassed, false)
  assert.equal(assessment.executionAllowed, false)
  assert.equal(assessment.reservationJournalDraft, null)
  assert.ok(assessment.reasons.includes('insufficient_available_quote_balance'))
})

test('stale price rejects before risk and reservation planning', async () => {
  const base = input()
  const assessment = await assessBitgetCandidateOrder(input({
    previewOptions: {
      ...base.previewOptions,
      referencePrice: {
        ...base.previewOptions.referencePrice,
        observedAt: '2026-07-17T13:00:00.000Z',
        expiresAt: '2026-07-17T13:01:00.000Z',
      },
    },
  }))

  assert.equal(assessment.status, 'REJECTED')
  assert.equal(assessment.preview.accepted, false)
  assert.equal(assessment.riskDecision, null)
  assert.equal(assessment.reservationJournalDraft, null)
  assert.ok(assessment.reasons.includes('reference_price_stale'))
  assert.ok(assessment.reasons.includes('execution_locked'))
})

test('candidate assessment evidence is deterministic', async () => {
  const first = await assessBitgetCandidateOrder(input())
  const second = await assessBitgetCandidateOrder(input())
  assert.equal(first.evidenceHash, second.evidenceHash)
})
