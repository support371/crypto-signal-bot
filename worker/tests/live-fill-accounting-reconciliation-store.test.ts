import assert from 'node:assert/strict'
import test from 'node:test'

import {
  FillAccountingReconciliationConflictError,
  FillAccountingReconciliationUnavailableError,
  persistFillAccountingReconciliation,
  type FillAccountingReconciliationStoreEnv,
  type PersistFillAccountingReconciliationInput,
} from '../src/live/fill-accounting-reconciliation-store.ts'
import { asDecimalString } from '../src/live/decimal.ts'

interface FakeStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeStatement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<D1Result>
}

type Receipt = {
  input_hash: string
  reconciliation_hash: string
  status: 'CLEAR' | 'HALT_FOR_REVIEW'
  reasons_json: string
  reconstructed_quantity: string
  reconstructed_cost_basis_quote: string
  reconstructed_average_entry_price: string | null
  reconstructed_realized_pnl_quote: string
  ledger_base_inventory_balance: string
  exchange_base_balance: string | null
  current_price: string | null
  market_value_quote: string | null
  unrealized_pnl_quote: string | null
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

class FakeD1 {
  receipt: Receipt | null = null
  position: Record<string, unknown> | null = {
    quantity: '0.02',
    total_cost_basis_quote: '900',
    average_entry_price: '45000',
    cumulative_realized_pnl_quote: '240',
    status: 'OPEN',
  }
  lots: Record<string, unknown>[] = [
    { lot_id: 'lot-1', original_quantity: '0.01', original_cost_quote: '400' },
    { lot_id: 'lot-2', original_quantity: '0.01', original_cost_quote: '500' },
  ]
  consumptions: Record<string, unknown>[] = []
  realizedPnl: Record<string, unknown>[] = [
    { realized_pnl_quote: '250' },
    { realized_pnl_quote: '-10' },
  ]
  ledgerEntries: Record<string, unknown>[] = [
    { direction: 'DEBIT', amount: '0.03' },
    { direction: 'CREDIT', amount: '0.01' },
  ]
  queryCount = 0
  insertCount = 0
  statements: FakeStatement[] = []

  prepare(sql: string): D1PreparedStatement {
    this.queryCount += 1
    const database = this
    const base: FakeStatement = {
      sql,
      params: [],
      bind(...params: unknown[]) {
        const bound: FakeStatement = {
          sql,
          params,
          bind: base.bind,
          first: async <T>() => database.first<T>(sql),
          all: async <T>() => database.all<T>(sql),
          run: async () => database.run(sql, params),
        }
        database.statements.push(bound)
        return bound
      },
      first: async <T>() => database.first<T>(sql),
      all: async <T>() => database.all<T>(sql),
      run: async () => database.run(sql, []),
    }
    return base as unknown as D1PreparedStatement
  }

  async first<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM live_fill_accounting_reconciliations')) {
      return this.receipt as T | null
    }
    if (sql.includes('FROM live_position_accounting')) return this.position as T | null
    return null
  }

  async all<T>(sql: string): Promise<{ results: T[] }> {
    if (sql.includes('FROM live_cost_basis_lots') && !sql.includes('JOIN')) {
      return { results: this.lots as T[] }
    }
    if (sql.includes('FROM live_cost_basis_consumptions')) {
      return { results: this.consumptions as T[] }
    }
    if (sql.includes('FROM live_realized_pnl_events')) {
      return { results: this.realizedPnl as T[] }
    }
    if (sql.includes('FROM ledger_entries')) {
      return { results: this.ledgerEntries as T[] }
    }
    return { results: [] }
  }

  async run(sql: string, params: unknown[]): Promise<D1Result> {
    if (sql.includes('INSERT INTO live_fill_accounting_reconciliations')) {
      this.insertCount += 1
      this.receipt = {
        input_hash: String(params[6]),
        reconciliation_hash: String(params[23]),
        status: params[9] as Receipt['status'],
        reasons_json: String(params[10]),
        reconstructed_quantity: String(params[12]),
        reconstructed_cost_basis_quote: String(params[14]),
        reconstructed_average_entry_price: params[15] === null ? null : String(params[15]),
        reconstructed_realized_pnl_quote: String(params[17]),
        ledger_base_inventory_balance: String(params[18]),
        exchange_base_balance: params[19] === null ? null : String(params[19]),
        current_price: params[20] === null ? null : String(params[20]),
        market_value_quote: params[21] === null ? null : String(params[21]),
        unrealized_pnl_quote: params[22] === null ? null : String(params[22]),
        provider_mutation_allowed: 0,
        reservation_applied: 0,
        execution_allowed: 0,
      }
    }
    return {} as D1Result
  }

  env(): FillAccountingReconciliationStoreEnv {
    return { DB: this as unknown as D1Database }
  }
}

function input(
  overrides: Partial<PersistFillAccountingReconciliationInput> = {},
): PersistFillAccountingReconciliationInput {
  return {
    reconciliationId: 'reconciliation-store-1',
    exchangeName: 'BITGET',
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    ledgerBaseAccountIds: [
      'ledger:BTC:inventory',
      'ledger:BTC:reserved',
    ],
    exchangeBaseBalance: asDecimalString('0.02'),
    currentPrice: asDecimalString('60000'),
    exchangeObservationHash: 'a'.repeat(64),
    observedAt: '2026-07-17T22:00:00.000Z',
    ...overrides,
  }
}

test('matching accounting evidence projects an immutable clear reconciliation', async () => {
  const fake = new FakeD1()
  const result = await persistFillAccountingReconciliation(fake.env(), input())

  assert.equal(result.projectionStatus, 'PROJECTED')
  assert.equal(result.exchangeName, 'BITGET')
  assert.equal(result.status, 'CLEAR')
  assert.deepEqual(result.reasons, [])
  assert.equal(result.reconstructedQuantity, '0.02')
  assert.equal(result.reconstructedCostBasisQuote, '900')
  assert.equal(result.reconstructedAverageEntryPrice, '45000')
  assert.equal(result.reconstructedRealizedPnlQuote, '240')
  assert.equal(result.ledgerBaseInventoryBalance, '0.02')
  assert.equal(result.marketValueQuote, '1200')
  assert.equal(result.unrealizedPnlQuote, '300')
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(fake.insertCount, 1)
  assert.ok(fake.statements.some((statement) => (
    statement.sql.includes('FROM ledger_entries')
    && statement.sql.includes('AND asset = ?')
  )))
})

test('identical reconciliation replays every immutable result field', async () => {
  const fake = new FakeD1()
  const projected = await persistFillAccountingReconciliation(fake.env(), input())
  const replay = await persistFillAccountingReconciliation(fake.env(), input())

  assert.equal(replay.projectionStatus, 'REPLAYED')
  assert.equal(replay.reconciliationHash, projected.reconciliationHash)
  assert.equal(replay.reconstructedAverageEntryPrice, '45000')
  assert.equal(replay.marketValueQuote, '1200')
  assert.equal(replay.unrealizedPnlQuote, '300')
  assert.equal(fake.insertCount, 1)
})

test('same reconciliation ID with changed evidence is rejected', async () => {
  const fake = new FakeD1()
  await persistFillAccountingReconciliation(fake.env(), input())

  await assert.rejects(
    persistFillAccountingReconciliation(fake.env(), input({
      currentPrice: asDecimalString('61000'),
    })),
    FillAccountingReconciliationConflictError,
  )
  assert.equal(fake.insertCount, 1)
})

test('missing position projection fails closed before insert', async () => {
  const fake = new FakeD1()
  fake.position = null

  await assert.rejects(
    persistFillAccountingReconciliation(fake.env(), input()),
    FillAccountingReconciliationUnavailableError,
  )
  assert.equal(fake.insertCount, 0)
})

test('over-consumed lot is rejected before reconciliation insert', async () => {
  const fake = new FakeD1()
  fake.consumptions = [{
    lot_id: 'lot-1',
    quantity: '0.02',
    cost_basis_quote: '400',
  }]

  await assert.rejects(
    persistFillAccountingReconciliation(fake.env(), input()),
    /lot lot-1 is over-consumed/,
  )
  assert.equal(fake.insertCount, 0)
})

test('Coinbase and unknown providers fail before any D1 query', async () => {
  for (const exchangeName of ['COINBASE', 'UNKNOWN']) {
    const fake = new FakeD1()
    await assert.rejects(
      persistFillAccountingReconciliation(fake.env(), input({ exchangeName })),
      /Unsupported execution exchange/,
    )
    assert.equal(fake.queryCount, 0)
  }
})

test('corrupted replay capability flags are rejected', async () => {
  const fake = new FakeD1()
  await persistFillAccountingReconciliation(fake.env(), input())
  assert.ok(fake.receipt)
  fake.receipt.execution_allowed = 1

  await assert.rejects(
    persistFillAccountingReconciliation(fake.env(), input()),
    /permanent capability locks/,
  )
})

test('invalid replay reasons JSON is rejected', async () => {
  const fake = new FakeD1()
  await persistFillAccountingReconciliation(fake.env(), input())
  assert.ok(fake.receipt)
  fake.receipt.reasons_json = '{not-json'

  await assert.rejects(
    persistFillAccountingReconciliation(fake.env(), input()),
    /stored reconciliation reasons are not valid JSON/,
  )
})

test('ledger account scope is bounded unique and order-normalized for replay', async () => {
  const fake = new FakeD1()
  const projected = await persistFillAccountingReconciliation(fake.env(), input({
    ledgerBaseAccountIds: ['ledger:BTC:reserved', 'ledger:BTC:inventory'],
  }))
  const replay = await persistFillAccountingReconciliation(fake.env(), input({
    ledgerBaseAccountIds: ['ledger:BTC:inventory', 'ledger:BTC:reserved'],
  }))

  assert.equal(projected.reconciliationHash, replay.reconciliationHash)
  await assert.rejects(
    persistFillAccountingReconciliation(new FakeD1().env(), input({
      reconciliationId: 'duplicate-accounts',
      ledgerBaseAccountIds: ['ledger:BTC:inventory', 'ledger:BTC:inventory'],
    })),
    /ledgerBaseAccountIds must be unique/,
  )
})
