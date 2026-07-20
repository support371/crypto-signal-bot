import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import { fetchBitgetPublicClosedCandles } from '../src/certification/bitget-public-candles.ts'
import { persistCertificationEvidence } from '../src/certification/evidence-store.ts'
import { simulateCertificationFill } from '../src/certification/fill-simulation.ts'
import { assessCertificationSignalCandidate } from '../src/certification/signal-assessment-bridge.ts'
import { evaluateCertificationSignal } from '../src/certification/signal-engine.ts'
import type { CandidateOrderAssessmentInput } from '../src/live/candidate-command-plan.ts'
import { asDecimalString, asSignedDecimalString } from '../src/live/decimal.ts'
import type { ProductRules } from '../src/live/domain.ts'

const INTERVAL_MS = 5 * 60 * 1000
const CLOSED_BOUNDARY = 1_800_000_000_000
const NOW = CLOSED_BOUNDARY + 60_000
const here = path.dirname(fileURLToPath(import.meta.url))

interface SqliteD1Statement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): SqliteD1Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<D1Result<T>>
  run(): Promise<D1Result>
}

class CertificationSqliteD1 {
  readonly database = new DatabaseSync(':memory:')

  constructor() {
    this.database.exec('PRAGMA foreign_keys = ON;')
    this.database.exec(fs.readFileSync(
      path.resolve(here, '..', 'migrations', '030_live_certification_market_simulations.sql'),
      'utf8',
    ))
  }

  prepare(sql: string): D1PreparedStatement {
    const owner = this
    const statement = (params: unknown[] = []): SqliteD1Statement => ({
      sql,
      params,
      bind: (...next: unknown[]) => statement(next),
      first: async <T>() => {
        const row = owner.database.prepare(sql).get(...params) as T | undefined
        return row ?? null
      },
      all: async <T>() => ({
        results: owner.database.prepare(sql).all(...params) as T[],
      }) as D1Result<T>,
      run: async () => {
        const result = owner.database.prepare(sql).run(...params)
        return { meta: { changes: Number(result.changes) } } as D1Result
      },
    })
    return statement() as unknown as D1PreparedStatement
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const pending = statements as unknown as SqliteD1Statement[]
    this.database.exec('BEGIN IMMEDIATE;')
    try {
      const results: D1Result[] = []
      for (const statement of pending) results.push(await statement.run())
      this.database.exec('COMMIT;')
      return results
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
  }

  env() {
    return { DB: this as unknown as D1Database }
  }

  close(): void {
    this.database.close()
  }
}

function candleRows(direction: 'up' | 'down' | 'flat', count = 40): string[][] {
  let close = 50_000
  const rows: string[][] = []
  for (let index = 0; index < count; index += 1) {
    const open = close
    if (direction === 'up') close += index % 2 === 0 ? -1 : 2
    if (direction === 'down') close += index % 2 === 0 ? 1 : -2
    const high = Math.max(open, close) + 1
    const low = Math.min(open, close) - 1
    const start = CLOSED_BOUNDARY - (count - index) * INTERVAL_MS
    rows.push([
      String(start), String(open), String(high), String(low), String(close),
      '10', String(close * 10), String(close * 10),
    ])
  }
  return rows
}

async function signal(direction: 'up' | 'down' | 'flat' = 'up') {
  const snapshot = await fetchBitgetPublicClosedCandles('BTCUSDT', {
    now: () => NOW,
    fetcher: async () => Response.json({
      code: '00000',
      msg: 'success',
      requestTime: NOW,
      data: candleRows(direction).reverse(),
    }),
  })
  return evaluateCertificationSignal(snapshot, NOW)
}

const accountingAccounts = Object.freeze({
  baseInventoryAccountId: 'ledger:BTC:inventory',
  baseReservedAccountId: 'ledger:BTC:reserved',
  baseClearingAccountId: 'ledger:BTC:clearing',
  quoteAvailableAccountId: 'ledger:USDT:available',
  quoteReservedAccountId: 'ledger:USDT:reserved',
  quoteClearingAccountId: 'ledger:USDT:clearing',
  feeExpenseAccountId: 'ledger:USDT:fees',
  feeSourceAccountId: 'ledger:USDT:fee-source',
})

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
    observedAt: new Date(CLOSED_BOUNDARY - 60_000).toISOString(),
    expiresAt: new Date(CLOSED_BOUNDARY + 10 * 60_000).toISOString(),
  }
}

function assessmentInput(
  marketSignal: Awaited<ReturnType<typeof signal>>,
  overrides: Partial<CandidateOrderAssessmentInput> = {},
): CandidateOrderAssessmentInput {
  return {
    orderId: 'certification-order-1',
    exchangeAccountId: 'bitget-certification-account-ref',
    correlationId: 'certification-correlation-1',
    idempotencyKey: 'certification:signal:0001',
    configurationVersion: 'certification-risk-v1',
    riskDecisionId: 'certification-risk-decision-1',
    decidedAt: new Date(NOW).toISOString(),
    reservationJournalId: 'certification-reservation-draft-1',
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
        price: marketSignal.referencePrice,
        observedAt: new Date(marketSignal.latestClosedAtMs).toISOString(),
        expiresAt: new Date(marketSignal.latestClosedAtMs + 5 * 60_000).toISOString(),
      },
      feeRate: asDecimalString('0.001'),
      slippageBps: 100,
      now: () => new Date(NOW),
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

test('real-market signal binds to exact preview and risk evidence while every mutation stays locked', async () => {
  const marketSignal = await signal()
  const first = await assessCertificationSignalCandidate(
    marketSignal,
    assessmentInput(marketSignal),
    NOW,
  )
  const second = await assessCertificationSignalCandidate(
    marketSignal,
    assessmentInput(marketSignal),
    NOW,
  )

  assert.equal(marketSignal.direction, 'BUY')
  assert.equal(first.candidateAssessment.status, 'READY_BUT_EXECUTION_LOCKED')
  assert.notEqual(first.candidateAssessment.preview.estimatedFillPrice, null)
  assert.equal(first.signalEvidenceHash, marketSignal.evidenceHash)
  assert.equal(first.assessmentBindingHash, second.assessmentBindingHash)
  assert.match(first.assessmentBindingHash, /^[a-f0-9]{64}$/)
  assert.equal(first.reservationApplied, false)
  assert.equal(first.automaticallySubmitted, false)
  assert.equal(first.providerMutationAllowed, false)
  assert.equal(first.executionAllowed, false)
  assert.equal(first.realFundsAllowed, false)
  assert.equal(first.mainnetAllowed, false)
  assert.equal(first.withdrawalsAllowed, false)
})

test('HOLD signals cannot enter candidate order assessment', async () => {
  const holdSignal = await signal('flat')
  assert.equal(holdSignal.direction, 'HOLD')
  await assert.rejects(
    assessCertificationSignalCandidate(holdSignal, assessmentInput(holdSignal), NOW),
    /HOLD certification signals/,
  )
})

test('side, product, and reference-price mismatches fail before assessment', async () => {
  const marketSignal = await signal()
  const base = assessmentInput(marketSignal)
  await assert.rejects(
    assessCertificationSignalCandidate(marketSignal, {
      ...base,
      request: { ...base.request, side: 'SELL' },
    }, NOW),
    /side does not match/,
  )
  await assert.rejects(
    assessCertificationSignalCandidate(marketSignal, {
      ...base,
      request: { ...base.request, productId: 'ETH-USDT' },
    }, NOW),
    /product does not match/,
  )
  await assert.rejects(
    assessCertificationSignalCandidate(marketSignal, {
      ...base,
      previewOptions: {
        ...base.previewOptions,
        referencePrice: {
          ...base.previewOptions.referencePrice,
          price: asDecimalString('1'),
        },
      },
    }, NOW),
    /reference price does not match/,
  )
})

test('stale or tampered signal evidence cannot reach candidate assessment', async () => {
  const marketSignal = await signal()
  await assert.rejects(
    assessCertificationSignalCandidate(
      marketSignal,
      assessmentInput(marketSignal),
      marketSignal.latestClosedAtMs + 10 * 60_000 + 1,
    ),
    /stale/,
  )
  const tampered = { ...marketSignal, referencePrice: asDecimalString('1') }
  await assert.rejects(
    assessCertificationSignalCandidate(tampered, assessmentInput(marketSignal), NOW),
    /evidence hash does not match/,
  )
})

test('certification fills use locked estimates and production FIFO accounting without claiming an exchange fill', async () => {
  const buySignal = await signal('up')
  const buyAssessment = await assessCertificationSignalCandidate(
    buySignal,
    assessmentInput(buySignal),
    NOW,
  )
  const buy = await simulateCertificationFill({
    assessment: buyAssessment,
    simulatedAt: new Date(NOW).toISOString(),
    existingLots: [],
    cumulativeRealizedPnlQuote: asSignedDecimalString('0'),
    accounts: accountingAccounts,
  })

  assert.equal(buy.fill.side, 'BUY')
  assert.equal(buy.fill.exchangeOrderId.startsWith('certification-simulated-order:'), true)
  assert.equal(buy.accounting.position.status, 'OPEN')
  assert.notEqual(buy.accounting.acquiredLot, null)
  assert.equal(buy.providerOrderCreated, false)
  assert.equal(buy.providerFillClaimed, false)
  assert.equal(buy.automaticallyPersisted, false)
  assert.equal(buy.providerMutationAllowed, false)
  assert.equal(buy.executionAllowed, false)
  assert.equal(buy.realFundsAllowed, false)
  assert.match(buy.simulationHash, /^[a-f0-9]{64}$/)

  const sellSignal = await signal('down')
  const sellBase = assessmentInput(sellSignal)
  const sellAssessment = await assessCertificationSignalCandidate(sellSignal, {
    ...sellBase,
    orderId: 'certification-order-2',
    correlationId: 'certification-correlation-2',
    idempotencyKey: 'certification:signal:0002',
    riskDecisionId: 'certification-risk-decision-2',
    reservationJournalId: 'certification-reservation-draft-2',
    request: {
      ...sellBase.request,
      side: 'SELL',
      baseQuantity: asDecimalString('0.001'),
      quoteNotional: null,
    },
    reservationAccounts: {
      availableAccountId: 'ledger:BTC:available',
      reservedAccountId: 'ledger:BTC:reserved',
    },
  }, NOW)
  const sell = await simulateCertificationFill({
    assessment: sellAssessment,
    simulatedAt: new Date(NOW + 1).toISOString(),
    existingLots: buy.accounting.updatedLots,
    cumulativeRealizedPnlQuote: buy.accounting.position.cumulativeRealizedPnlQuote,
    accounts: accountingAccounts,
  })

  assert.equal(sell.fill.side, 'SELL')
  assert.equal(sell.accounting.lotConsumptions.length, 1)
  assert.notEqual(sell.accounting.realizedPnlEvent, null)
  assert.equal(sell.accounting.method, 'FIFO')
  assert.equal(sell.providerOrderCreated, false)
  assert.equal(sell.providerFillClaimed, false)
})

test('serialization or object spread cannot preserve the in-process assessment verification brand', async () => {
  const marketSignal = await signal()
  const assessment = await assessCertificationSignalCandidate(
    marketSignal,
    assessmentInput(marketSignal),
    NOW,
  )
  const spread = { ...assessment }
  await assert.rejects(
    simulateCertificationFill({
      assessment: spread,
      simulatedAt: new Date(NOW).toISOString(),
      existingLots: [],
      cumulativeRealizedPnlQuote: asSignedDecimalString('0'),
      accounts: accountingAccounts,
    }),
    /not verified in this process/,
  )
})

test('explicit D1 projection persists signal, assessment, and simulated FIFO evidence atomically and replays', async () => {
  const database = new CertificationSqliteD1()
  try {
    const marketSignal = await signal()
    const assessment = await assessCertificationSignalCandidate(
      marketSignal,
      assessmentInput(marketSignal),
      NOW,
    )
    const simulation = await simulateCertificationFill({
      assessment,
      simulatedAt: new Date(NOW).toISOString(),
      existingLots: [],
      cumulativeRealizedPnlQuote: asSignedDecimalString('0'),
      accounts: accountingAccounts,
    })
    const projected = await persistCertificationEvidence(
      database.env(),
      marketSignal,
      assessment,
      simulation,
      new Date(NOW + 1).toISOString(),
    )
    const replayed = await persistCertificationEvidence(
      database.env(),
      marketSignal,
      assessment,
      simulation,
      new Date(NOW + 2).toISOString(),
    )

    assert.equal(projected.projectionStatus, 'PROJECTED')
    assert.equal(replayed.projectionStatus, 'REPLAYED')
    assert.equal(replayed.persistedAt, projected.persistedAt)
    assert.equal(projected.providerMutationAllowed, false)
    assert.equal(projected.executionAllowed, false)
    assert.equal(projected.realFundsAllowed, false)
    assert.equal(database.database.prepare(
      'SELECT COUNT(*) AS count FROM live_certification_signal_evidence',
    ).get().count, 1)
    assert.equal(database.database.prepare(
      'SELECT COUNT(*) AS count FROM live_certification_signal_assessments',
    ).get().count, 1)
    assert.equal(database.database.prepare(
      'SELECT COUNT(*) AS count FROM live_certification_fill_simulations',
    ).get().count, 1)
  } finally {
    database.close()
  }
})
