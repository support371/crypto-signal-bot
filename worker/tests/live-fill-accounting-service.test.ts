import assert from 'node:assert/strict'
import test from 'node:test'

import { canonicalHash } from '../src/live/canonical-json.ts'
import {
  FillAccountingConflictError,
  type PersistSpotFillAccountingInput,
} from '../src/live/fill-accounting-store.ts'
import { persistSpotFillAccountingVerified } from '../src/live/fill-accounting-service.ts'
import { asDecimalString } from '../src/live/decimal.ts'

class FakeStatement {
  private readonly database: FakeDatabase
  readonly sql: string
  readonly params: unknown[]

  constructor(database: FakeDatabase, sql: string, params: unknown[] = []) {
    this.database = database
    this.sql = sql
    this.params = params
  }

  bind(...params: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.database, this.sql, params) as unknown as D1PreparedStatement
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.database.first(this.sql, this.params) as T | null)
  }
}

class FakeDatabase {
  receiptPresence: { accounting_receipt_id: string } | null = null
  receipt: { input_hash: string; accounting_hash: string; journal_id: string } | null = null
  journal: { journal_id: string } | null = null
  position: {
    quantity: string
    cumulative_realized_pnl_quote: string
    last_accounting_hash: string
  } | null = null

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string, _params: unknown[]): unknown {
    if (sql.includes('SELECT accounting_receipt_id')) return this.receiptPresence
    if (sql.includes('SELECT input_hash, accounting_hash, journal_id')) return this.receipt
    if (sql.includes('SELECT journal_id') && sql.includes('FROM ledger_journals')) return this.journal
    if (sql.includes('SELECT quantity, cumulative_realized_pnl_quote')) return this.position
    return null
  }

  asD1(): D1Database {
    return this as unknown as D1Database
  }
}

function input(): PersistSpotFillAccountingInput {
  return {
    exchangeAccountId: 'bitget-account-ref',
    internalOrderId: 'order-replay-1',
    correlationId: 'correlation-replay-1',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    fill: {
      fillId: 'fill-replay-1',
      tradeId: 'trade-replay-1',
      exchangeOrderId: 'exchange-order-replay-1',
      productId: 'BTC-USDT',
      side: 'BUY',
      price: asDecimalString('50000'),
      baseSize: asDecimalString('0.01'),
      commission: asDecimalString('0'),
      commissionAsset: null,
      tradeTime: '2026-07-17T21:00:00.000Z',
      sequenceTimestamp: '2026-07-17T21:00:01.000Z',
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
  }
}

async function requestHash(value: PersistSpotFillAccountingInput): Promise<string> {
  return canonicalHash({
    exchangeAccountId: value.exchangeAccountId,
    internalOrderId: value.internalOrderId,
    correlationId: value.correlationId,
    baseAsset: value.baseAsset,
    quoteAsset: value.quoteAsset,
    fill: value.fill,
    feeQuoteValue: value.feeQuoteValue,
    accounts: value.accounts,
    rawResponseHash: value.rawResponseHash,
  })
}

test('orphaned ledger journal without receipt is quarantined before accounting', async () => {
  const database = new FakeDatabase()
  database.journal = { journal_id: 'fill-accounting-journal:fill-replay-1' }

  await assert.rejects(
    persistSpotFillAccountingVerified({ DB: database.asD1() }, input()),
    (error: unknown) => error instanceof FillAccountingConflictError
      && /orphaned fill-accounting journal/.test(error.message),
  )
})

test('replay returns persisted position quantity and cumulative realized PnL', async () => {
  const database = new FakeDatabase()
  const accountingHash = 'b'.repeat(64)
  database.receiptPresence = { accounting_receipt_id: 'fill-accounting-receipt:fill-replay-1' }
  database.receipt = {
    input_hash: await requestHash(input()),
    accounting_hash: accountingHash,
    journal_id: 'fill-accounting-journal:fill-replay-1',
  }
  database.position = {
    quantity: '0.025',
    cumulative_realized_pnl_quote: '-12.5',
    last_accounting_hash: accountingHash,
  }

  const result = await persistSpotFillAccountingVerified({ DB: database.asD1() }, input())

  assert.equal(result.status, 'REPLAYED')
  assert.equal(result.positionQuantity, '0.025')
  assert.equal(result.cumulativeRealizedPnlQuote, '-12.5')
  assert.equal(result.replayStateVerified, true)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
})

test('replay rejects a position projection with a different accounting hash', async () => {
  const database = new FakeDatabase()
  database.receiptPresence = { accounting_receipt_id: 'fill-accounting-receipt:fill-replay-1' }
  database.receipt = {
    input_hash: await requestHash(input()),
    accounting_hash: 'b'.repeat(64),
    journal_id: 'fill-accounting-journal:fill-replay-1',
  }
  database.position = {
    quantity: '0.025',
    cumulative_realized_pnl_quote: '10',
    last_accounting_hash: 'c'.repeat(64),
  }

  await assert.rejects(
    persistSpotFillAccountingVerified({ DB: database.asD1() }, input()),
    (error: unknown) => error instanceof FillAccountingConflictError
      && /position accounting hash/.test(error.message),
  )
})
