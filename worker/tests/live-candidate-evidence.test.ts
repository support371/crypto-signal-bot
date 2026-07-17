import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessBitgetCandidateOrder,
  type CandidateOrderAssessmentInput,
} from '../src/live/candidate-command-plan.ts'
import {
  attachCoordinatorSequence,
  buildCandidateEvidenceBase,
  CandidateEvidenceConflictError,
  projectCandidateEvidenceToD1,
} from '../src/live/candidate-evidence.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'

interface FakeBoundStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeBoundStatement
  first<T>(): Promise<T | null>
}

interface FakeReceipt {
  assessment_id: string
  payload_hash: string
}

class FakeD1 {
  readonly receipts = new Map<string, FakeReceipt>()
  readonly batches: FakeBoundStatement[][] = []

  prepare(sql: string): D1PreparedStatement {
    const database = this
    const statement: FakeBoundStatement = {
      sql,
      params: [],
      bind(...params: unknown[]) {
        return {
          ...statement,
          params,
          bind: statement.bind,
          first: async <T>() => database.first<T>(sql, params),
        }
      },
      first: async <T>() => database.first<T>(sql, []),
    }
    return statement as unknown as D1PreparedStatement
  }

  async first<T>(sql: string, params: unknown[]): Promise<T | null> {
    if (sql.includes('live_candidate_projection_receipts')) {
      const eventId = String(params[0] ?? '')
      return (this.receipts.get(eventId) ?? null) as T | null
    }
    return null
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const bound = statements as unknown as FakeBoundStatement[]
    this.batches.push(bound)
    const receipt = bound.find((statement) => statement.sql.includes('live_candidate_projection_receipts'))
    if (receipt) {
      const [projectionEventId, assessmentId, , , payloadHash] = receipt.params
      this.receipts.set(String(projectionEventId), {
        assessment_id: String(assessmentId),
        payload_hash: String(payloadHash),
      })
    }
    return []
  }

  asDatabase(): D1Database {
    return this as unknown as D1Database
  }
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
    observedAt: '2026-07-17T14:00:00.000Z',
    expiresAt: '2026-07-17T14:10:00.000Z',
  }
}

function input(overrides: Partial<CandidateOrderAssessmentInput> = {}): CandidateOrderAssessmentInput {
  return {
    orderId: 'order-evidence-1',
    exchangeAccountId: 'bitget-account-ref',
    correlationId: 'correlation-evidence-1',
    idempotencyKey: 'candidate:evidence:0001',
    configurationVersion: 'risk-config-v1',
    riskDecisionId: 'risk-evidence-1',
    decidedAt: '2026-07-17T14:05:00.000Z',
    reservationJournalId: 'reservation-evidence-1',
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

async function readyEnvelope() {
  const assessmentInput = input()
  const assessment = await assessBitgetCandidateOrder(assessmentInput)
  const base = await buildCandidateEvidenceBase(
    assessmentInput,
    assessment,
    '2026-07-17T14:05:01.000Z',
  )
  return attachCoordinatorSequence(base, 'coordinator-bitget-account-ref', 1)
}

test('candidate evidence envelope is deterministic and permanently execution-locked', async () => {
  const assessmentInput = input()
  const assessment = await assessBitgetCandidateOrder(assessmentInput)
  const first = await buildCandidateEvidenceBase(
    assessmentInput,
    assessment,
    '2026-07-17T14:05:01.000Z',
  )
  const second = await buildCandidateEvidenceBase(
    assessmentInput,
    assessment,
    '2026-07-17T14:05:01.000Z',
  )

  assert.deepEqual(first, second)
  assert.equal(first.executionAllowed, false)
  assert.equal(first.status, 'READY_BUT_EXECUTION_LOCKED')
  assert.ok(first.reservation)
  assert.equal(first.reservation?.asset, 'USDT')
  assert.equal(first.reservation?.amount, '100.1')
  assert.match(first.requestHash, /^[a-f0-9]{64}$/)
  assert.match(first.payloadHash, /^[a-f0-9]{64}$/)
})

test('rejected assessment persists no reservation draft', async () => {
  const rejectedInput = input({
    risk: {
      ...input().risk,
      availableQuoteBalance: asDecimalString('10'),
    },
  })
  const assessment = await assessBitgetCandidateOrder(rejectedInput)
  const base = await buildCandidateEvidenceBase(
    rejectedInput,
    assessment,
    '2026-07-17T14:05:01.000Z',
  )

  assert.equal(base.status, 'REJECTED')
  assert.equal(base.executionAllowed, false)
  assert.equal(base.reservation, null)
})

test('D1 projection uses one transactional batch for assessment, reservation, and receipt', async () => {
  const fake = new FakeD1()
  const envelope = await readyEnvelope()
  const result = await projectCandidateEvidenceToD1(fake.asDatabase(), envelope)

  assert.equal(result.status, 'PROJECTED')
  assert.equal(fake.batches.length, 1)
  assert.equal(fake.batches[0]?.length, 3)
  assert.ok(fake.batches[0]?.[0]?.sql.includes('live_candidate_assessments'))
  assert.ok(fake.batches[0]?.[1]?.sql.includes('live_candidate_reservation_drafts'))
  assert.ok(fake.batches[0]?.[2]?.sql.includes('live_candidate_projection_receipts'))
})

test('D1 projection replays the same payload without another batch', async () => {
  const fake = new FakeD1()
  const envelope = await readyEnvelope()
  await projectCandidateEvidenceToD1(fake.asDatabase(), envelope)
  const replay = await projectCandidateEvidenceToD1(fake.asDatabase(), envelope)

  assert.equal(replay.status, 'REPLAYED')
  assert.equal(fake.batches.length, 1)
})

test('D1 projection rejects an existing event with a different payload', async () => {
  const fake = new FakeD1()
  const envelope = await readyEnvelope()
  fake.receipts.set(envelope.projectionEventId, {
    assessment_id: 'different-assessment',
    payload_hash: 'f'.repeat(64),
  })

  await assert.rejects(
    projectCandidateEvidenceToD1(fake.asDatabase(), envelope),
    CandidateEvidenceConflictError,
  )
  assert.equal(fake.batches.length, 0)
})
