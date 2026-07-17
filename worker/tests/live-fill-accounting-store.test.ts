import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FillAccountingConflictError,
  persistSpotFillAccountingFifo,
  type FillAccountingStoreEnv,
  type PersistSpotFillAccountingInput,
} from '../src/live/fill-accounting-store.ts'
import { asDecimalString } from '../src/live/decimal.ts'

interface FakeStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
}

type Receipt = {
  accounting_receipt_id: string
  input_hash: string
  accounting_hash: string
  journal_id: string
  position_quantity: string
  cumulative_realized_pnl_quote: string
}

class FakeD1 {
  receipt: Receipt | null = null
  existingFill: Record<string, unknown> | null = null
  existingJournal: Record<string, unknown> | null = null
  lots: Record<string, unknown>[] = []
  consumptions: Record<string, unknown>[] = []
  position: Record<string, unknown> | null = null
  batches: FakeStatement[][] = []

  prepare(sql: string): D1PreparedStatement {
    const database = this
    const base: FakeStatement = {
      sql,
      params: [],
      bind(...params: unknown[]) {
        const bound: FakeStatement = {
          sql,
          params,
          bind: base.bind,
          first: async <T>() => database.first<T>(sql, params),
          all: async <T>() => database.all<T>(sql, params),
        }
        return bound
      },
      first: async <T>() => database.first<T>(sql, []),
      all: async <T>() => database.all<T>(sql, []),
    }
    return base as unknown as D1PreparedStatement
  }

  async first<T>(sql: string, _params: unknown[]): Promise<T | null> {
    if (sql.includes('FROM live_fill_accounting_receipts')) {
      return this.receipt as T | null
    }
    if (sql.includes('FROM live_fills')) return this.existingFill as T | null
    if (sql.includes('FROM ledger_journals')) return this.existingJournal as T | null
    if (sql.includes('FROM live_position_accounting')) return this.position as T | null
    return null
  }

  async all<T>(sql: string, _params: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes('FROM live_cost_basis_lots') && !sql.includes('JOIN')) {
      return { results: this.lots as T[] }
    }
    if (sql.includes('FROM live_cost_basis_consumptions')) {
      return { results: this.consumptions as T[] }
    }
    return { results: [] }
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const bound = statements as unknown as FakeStatement[]
    this.batches.push(bound)
    const receiptStatement = bound.find((statement) => (
      statement.sql.includes('INSERT INTO live_fill_accounting_receipts')
    ))
    if (receiptStatement) {
      const [
        accountingReceiptId,
        ,
        ,
        ,
        ,
        inputHash,
        accountingHash,
        journalId,
        positionQuantity,
        cumulativeRealizedPnlQuote,
      ] = receiptStatement.params
      this.receipt = {
        accounting_receipt_id: String(accountingReceiptId),
        input_hash: String(inputHash),
        accounting_hash: String(accountingHash),
        journal_id: String(journalId),
        position_quantity: String(positionQuantity),
        cumulative_realized_pnl_quote: String(cumulativeRealizedPnlQuote),
      }
    }
    return []
  }

  asDatabase(): D1Database {
    return this as unknown as D1Database
  }
}

function storeEnv(fake: FakeD1): FillAccountingStoreEnv {
  return { DB: fake.asDatabase() }
}

function input(overrides: Partial<PersistSpotFillAccountingInput> = {}): PersistSpotFillAccountingInput {
  return {
    exchangeAccountId: 'bitget-account-ref',
    internalOrderId: 'internal-order-1',
    correlationId: 'correlation-fill-1',
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
      tradeTime: '2026-07-17T20:00:00.000Z',
      sequenceTimestamp: '2026-07-17T20:00:01.000Z',
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
    rawResponseHash: 'a'.repeat(64),
    ...overrides,
  }
}

function lotRow(
  lotId: string,
  quantity: string,
  cost: string,
  acquiredAt: string,
): Record<string, unknown> {
  return {
    lot_id: lotId,
    exchange_account_id: 'bitget-account-ref',
    product_id: 'BTC-USDT',
    base_asset: 'BTC',
    quote_asset: 'USDT',
    acquired_fill_id: `acquired-${lotId}`,
    acquired_at: acquiredAt,
    original_quantity: quantity,
    original_cost_quote: cost,
    unit_cost_quote: lotId === 'lot-1' ? '40000' : '50000',
    method: 'FIFO',
  }
}

test('buy accounting uses one D1 batch with receipt last', async () => {
  const fake = new FakeD1()
  const result = await persistSpotFillAccountingFifo(storeEnv(fake), input())

  assert.equal(result.status, 'PROJECTED')
  assert.equal(result.positionQuantity, '0.01')
  assert.equal(result.cumulativeRealizedPnlQuote, '0')
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(fake.batches.length, 1)

  const statements = fake.batches[0]
  assert.ok(statements[0]?.sql.includes('live_fills'))
  assert.ok(statements.some((statement) => statement.sql.includes('ledger_journals')))
  assert.equal(
    statements.filter((statement) => statement.sql.includes('INSERT INTO ledger_entries')).length,
    4,
  )
  assert.ok(statements.some((statement) => statement.sql.includes('live_cost_basis_lots')))
  assert.ok(statements.some((statement) => statement.sql.includes('live_position_accounting')))
  assert.ok(statements.at(-1)?.sql.includes('live_fill_accounting_receipts'))
})

test('same fill and request replays exact immutable receipt without a second batch', async () => {
  const fake = new FakeD1()
  const first = await persistSpotFillAccountingFifo(storeEnv(fake), input())
  const replay = await persistSpotFillAccountingFifo(storeEnv(fake), input())

  assert.equal(replay.status, 'REPLAYED')
  assert.equal(replay.accountingHash, first.accountingHash)
  assert.equal(replay.positionQuantity, first.positionQuantity)
  assert.equal(replay.cumulativeRealizedPnlQuote, first.cumulativeRealizedPnlQuote)
  assert.equal(fake.batches.length, 1)
})

test('same fill ID with changed financial input is rejected as conflict', async () => {
  const fake = new FakeD1()
  await persistSpotFillAccountingFifo(storeEnv(fake), input())

  await assert.rejects(
    persistSpotFillAccountingFifo(storeEnv(fake), input({
      fill: {
        ...input().fill,
        price: asDecimalString('51000'),
      },
    })),
    FillAccountingConflictError,
  )
  assert.equal(fake.batches.length, 1)
})

test('sell accounting persists FIFO consumptions, realized PnL, position, and receipt together', async () => {
  const fake = new FakeD1()
  fake.lots = [
    lotRow('lot-1', '0.01', '400', '2026-07-15T10:00:00.000Z'),
    lotRow('lot-2', '0.02', '1000', '2026-07-16T10:00:00.000Z'),
  ]
  const sellInput = input({
    fill: {
      ...input().fill,
      fillId: 'fill-sell-1',
      tradeId: 'trade-sell-1',
      side: 'SELL',
      price: asDecimalString('60000'),
      baseSize: asDecimalString('0.015'),
    },
  })

  const result = await persistSpotFillAccountingFifo(storeEnv(fake), sellInput)

  assert.equal(result.positionQuantity, '0.015')
  assert.equal(result.cumulativeRealizedPnlQuote, '250')
  const statements = fake.batches[0]
  assert.equal(
    statements.filter((statement) => statement.sql.includes('live_cost_basis_consumptions')).length,
    2,
  )
  assert.equal(
    statements.filter((statement) => statement.sql.includes('live_realized_pnl_events')).length,
    1,
  )
  assert.ok(statements.at(-1)?.sql.includes('live_fill_accounting_receipts'))
})

test('incompatible pre-existing fill blocks accounting before batch', async () => {
  const fake = new FakeD1()
  fake.existingFill = {
    trade_id: 'different-trade',
    exchange_account_id: 'bitget-account-ref',
    internal_order_id: 'internal-order-1',
    exchange_order_id: 'exchange-order-1',
    product_id: 'BTC-USDT',
    side: 'BUY',
    price: '50000',
    base_size: '0.01',
    commission: '0',
    commission_asset: null,
    trade_time: '2026-07-17T20:00:00.000Z',
    sequence_timestamp: '2026-07-17T20:00:01.000Z',
    raw_response_hash: 'a'.repeat(64),
  }

  await assert.rejects(
    persistSpotFillAccountingFifo(storeEnv(fake), input()),
    FillAccountingConflictError,
  )
  assert.equal(fake.batches.length, 0)
})

test('orphaned ledger journal blocks accounting rather than being reused', async () => {
  const fake = new FakeD1()
  fake.existingJournal = { journal_id: 'fill-accounting-journal:fill-1' }

  await assert.rejects(
    persistSpotFillAccountingFifo(storeEnv(fake), input()),
    /ledger journal exists without an immutable fill-accounting receipt/,
  )
  assert.equal(fake.batches.length, 0)
})

test('over-consumed persisted lot is rejected before accounting batch', async () => {
  const fake = new FakeD1()
  fake.lots = [lotRow('lot-1', '0.01', '400', '2026-07-15T10:00:00.000Z')]
  fake.consumptions = [{
    lot_id: 'lot-1',
    quantity: '0.02',
    cost_basis_quote: '400',
  }]

  await assert.rejects(
    persistSpotFillAccountingFifo(storeEnv(fake), input({
      fill: {
        ...input().fill,
        fillId: 'fill-sell-overconsumed',
        tradeId: 'trade-sell-overconsumed',
        side: 'SELL',
      },
    })),
    /lot lot-1 is over-consumed/,
  )
  assert.equal(fake.batches.length, 0)
})
