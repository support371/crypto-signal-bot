import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import {
  persistReservationSettlement,
  ReservationSettlementConflictError,
  type PersistReservationSettlementInput,
} from '../src/live/reservation-settlement-store.ts'

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
    return Promise.resolve(this.database.first(this.sql) as T | null)
  }

  all<T>(): Promise<D1Result<T>> {
    return Promise.resolve({
      success: true,
      results: this.database.all(this.sql) as T[],
      meta: {},
    } as D1Result<T>)
  }
}

type SettlementReceipt = {
  settlement_receipt_id: string
  request_hash: string
  accounting_hash: string
  reservation_id: string
  fill_id: string
  consumed_delta: string
  next_consumed_amount: string
  released_amount: string
  next_status: 'PARTIALLY_CONSUMED' | 'CONSUMED' | 'RELEASED'
  next_version: number
  settlement_hash: string
  release_journal_id: string | null
  reservation_state_updated: number
  release_journal_posted: number
  provider_mutation_allowed: number
  execution_allowed: number
}

class FakeDatabase {
  existingReceipt: SettlementReceipt | null = null
  accountingReceipt = {
    internal_order_id: 'order-1',
    accounting_hash: 'a'.repeat(64),
    journal_id: 'fill-accounting-journal:fill-1',
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
  }
  reservation = {
    reservation_id: 'reservation-1',
    exchange_account_id: 'bitget-account-ref',
    order_id: 'order-1',
    asset: 'USDT',
    amount: '150',
    consumed_amount: '0',
    status: 'ACTIVE',
    version: 0,
  }
  journal = {
    journal_id: 'fill-accounting-journal:fill-1',
    exchange_account_id: 'bitget-account-ref',
    event_type: 'SPOT_FILL_POSTED',
    reference_type: 'FILL',
    reference_id: 'fill-1',
    correlation_id: 'correlation-fill-1',
    idempotency_key: 'fill-accounting:fill-1',
    status: 'POSTED',
  }
  entries = [
    {
      entry_id: 'entry-btc-inventory',
      ledger_account_id: 'ledger:BTC:inventory',
      asset: 'BTC',
      direction: 'DEBIT',
      amount: '0.002',
    },
    {
      entry_id: 'entry-btc-clearing',
      ledger_account_id: 'ledger:BTC:clearing',
      asset: 'BTC',
      direction: 'CREDIT',
      amount: '0.002',
    },
    {
      entry_id: 'entry-usdt-clearing',
      ledger_account_id: 'ledger:USDT:clearing',
      asset: 'USDT',
      direction: 'DEBIT',
      amount: '100',
    },
    {
      entry_id: 'entry-usdt-reserved',
      ledger_account_id: 'ledger:USDT:reserved',
      asset: 'USDT',
      direction: 'CREDIT',
      amount: '100',
    },
    {
      entry_id: 'entry-usdt-fee',
      ledger_account_id: 'ledger:USDT:fees',
      asset: 'USDT',
      direction: 'DEBIT',
      amount: '0.1',
    },
    {
      entry_id: 'entry-usdt-fee-source',
      ledger_account_id: 'ledger:USDT:reserved',
      asset: 'USDT',
      direction: 'CREDIT',
      amount: '0.1',
    },
  ]
  readonly batches: FakeStatement[][] = []

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string): unknown {
    if (sql.includes('FROM live_reservation_settlement_receipts')) return this.existingReceipt
    if (sql.includes('FROM live_fill_accounting_receipts')) return this.accountingReceipt
    if (sql.includes('FROM reservations')) return this.reservation
    if (sql.includes('FROM ledger_journals')) return this.journal
    return null
  }

  all(sql: string): unknown[] {
    if (sql.includes('FROM ledger_entries')) return this.entries
    return []
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const bound = statements as unknown as FakeStatement[]
    this.batches.push(bound)
    const receipt = bound.find((statement) =>
      statement.sql.includes('INSERT INTO live_reservation_settlement_receipts'))
    assert.ok(receipt)
    const params = receipt.params
    this.existingReceipt = {
      settlement_receipt_id: String(params[0]),
      fill_id: String(params[1]),
      accounting_hash: String(params[2]),
      request_hash: String(params[3]),
      reservation_id: String(params[4]),
      consumed_delta: String(params[8]),
      next_consumed_amount: String(params[10]),
      released_amount: String(params[11]),
      next_status: String(params[13]) as SettlementReceipt['next_status'],
      next_version: Number(params[7]),
      release_journal_id: params[14] === null ? null : String(params[14]),
      settlement_hash: String(params[15]),
      reservation_state_updated: 1,
      release_journal_posted: Number(params[16]),
      provider_mutation_allowed: 0,
      execution_allowed: 0,
    }
    return []
  }

  asD1(): D1Database {
    return this as unknown as D1Database
  }
}

function input(overrides: Partial<PersistReservationSettlementInput> = {}): PersistReservationSettlementInput {
  return {
    reservationId: 'reservation-1',
    fillId: 'fill-1',
    accountingHash: 'a'.repeat(64),
    terminalFill: false,
    availableAccountId: 'ledger:USDT:available',
    reservedAccountId: 'ledger:USDT:reserved',
    releaseJournalId: 'reservation-release:fill-1',
    correlationId: 'correlation-settlement-1',
    idempotencyKey: 'reservation:settlement:fill-1',
    settledAt: '2026-07-17T21:30:00.000Z',
    ...overrides,
  }
}

test('partial settlement updates reservation and inserts receipt/event in one D1 batch', async () => {
  const database = new FakeDatabase()
  const result = await persistReservationSettlement({ DB: database.asD1() }, input())

  assert.equal(result.status, 'SETTLED')
  assert.equal(result.consumedDelta, '100.1')
  assert.equal(result.nextConsumedAmount, '100.1')
  assert.equal(result.releasedAmount, '0')
  assert.equal(result.nextStatus, 'PARTIALLY_CONSUMED')
  assert.equal(result.nextVersion, 1)
  assert.equal(result.reservationStateUpdated, true)
  assert.equal(result.releaseJournalPosted, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(database.batches.length, 1)
  assert.equal(database.batches[0]?.length, 3)

  const update = database.batches[0]?.find((statement) =>
    statement.sql.includes('UPDATE reservations'))
  assert.ok(update)
  assert.ok(update.sql.includes('AND consumed_amount = ?'))
  assert.ok(update.sql.includes('AND status = ?'))
  assert.ok(update.sql.includes('AND version = ?'))
})

test('terminal settlement posts exact release journal in the same batch', async () => {
  const database = new FakeDatabase()
  const result = await persistReservationSettlement(
    { DB: database.asD1() },
    input({ terminalFill: true }),
  )

  assert.equal(result.nextStatus, 'RELEASED')
  assert.equal(result.releasedAmount, '49.9')
  assert.equal(result.releaseJournalPosted, true)
  assert.equal(database.batches[0]?.length, 6)
  assert.ok(database.batches[0]?.some((statement) =>
    statement.sql.includes('INSERT INTO ledger_journals')))
  assert.equal(database.batches[0]?.filter((statement) =>
    statement.sql.includes('INSERT INTO ledger_entries')).length, 2)
})

test('identical settlement request replays immutable receipt without another batch', async () => {
  const database = new FakeDatabase()
  await persistReservationSettlement({ DB: database.asD1() }, input())
  const replay = await persistReservationSettlement({ DB: database.asD1() }, input())

  assert.equal(replay.status, 'REPLAYED')
  assert.equal(replay.nextConsumedAmount, '100.1')
  assert.equal(database.batches.length, 1)
})

test('mismatched immutable fill accounting hash is rejected before settlement', async () => {
  const database = new FakeDatabase()
  await assert.rejects(
    persistReservationSettlement(
      { DB: database.asD1() },
      input({ accountingHash: 'b'.repeat(64) }),
    ),
    (error: unknown) => error instanceof ReservationSettlementConflictError
      && /accounting receipt is missing or mismatched/.test(error.message),
  )
  assert.equal(database.batches.length, 0)
})

test('settlement refuses accounting evidence with any enabled capability lock', async () => {
  const database = new FakeDatabase()
  database.accountingReceipt = {
    ...database.accountingReceipt,
    execution_allowed: 1,
  }
  await assert.rejects(
    persistReservationSettlement({ DB: database.asD1() }, input()),
    (error: unknown) => error instanceof ReservationSettlementConflictError
      && /permanent capability locks/.test(error.message),
  )
  assert.equal(database.batches.length, 0)
})

test('receipt replay rejects a conflicting terminal instruction', async () => {
  const database = new FakeDatabase()
  await persistReservationSettlement({ DB: database.asD1() }, input())
  await assert.rejects(
    persistReservationSettlement(
      { DB: database.asD1() },
      input({ terminalFill: true }),
    ),
    ReservationSettlementConflictError,
  )
})
