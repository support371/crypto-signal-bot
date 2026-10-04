import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { asDecimalString } from '../src/live/decimal.ts'
import { persistSpotFillAccountingVerified, type VerifiedSpotFillAccountingInput } from '../src/live/fill-accounting-service.ts'
import { persistReservationSettlement } from '../src/live/reservation-settlement-store.ts'
import { persistCompletedOrder } from '../src/live/order-completion-store.ts'
const ACCOUNT = 'bitget-account-ref'
const TOKEN = 'local-test-token'
class SqliteD1 {
  readonly sql = new DatabaseSync(':memory:')
  failFill: string | null = null
  failDispatch = false
  constructor() {
    this.sql.exec('PRAGMA foreign_keys=ON')
    const root = new URL('../migrations/', import.meta.url)
    for (const file of fs.readdirSync(root).filter((name) => /^(00[3-9]|01\d|02\d|030)_.*\.sql$/.test(name)).sort()) {
      this.sql.exec(fs.readFileSync(new URL(file, root), 'utf8'))
    }
    this.sql.prepare(`INSERT INTO live_exchange_accounts
      (exchange_account_id,exchange_name,external_account_ref_hash,status)
      VALUES (?,'BITGET',?,'READ_ONLY')`).run(ACCOUNT, 'a'.repeat(64))
    for (const [id, asset, type] of [
      ['base-inventory', 'BTC', 'INVENTORY_AVAILABLE'], ['base-reserved', 'BTC', 'INVENTORY_RESERVED'],
      ['base-clearing', 'BTC', 'EXCHANGE_CLEARING'], ['quote-available', 'USDT', 'CASH_AVAILABLE'],
      ['quote-reserved', 'USDT', 'CASH_RESERVED'], ['quote-clearing', 'USDT', 'EXCHANGE_CLEARING'],
      ['fee-expense', 'USDT', 'FEES_EXPENSE'],
    ]) this.sql.prepare(`INSERT INTO ledger_accounts
      (ledger_account_id,exchange_account_id,asset,account_type) VALUES (?,?,?,?)`).run(id, ACCOUNT, asset, type)
    for (const [id, side] of [['buy-order', 'BUY'], ['sell-order', 'SELL']]) {
      this.sql.prepare(`INSERT INTO live_orders (internal_order_id,exchange_account_id,
        exchange_order_id,product_id,side,order_type,state,requested_base_quantity,
        configuration_version,created_at,updated_at)
        VALUES (?, ?, ?, 'BTC-USDT', ?, 'LIMIT', 'RECOVERY_REQUIRED', '0.01', 'test', ?, ?)`)
        .run(id, ACCOUNT, `exchange-${id}`, side, new Date().toISOString(), new Date().toISOString())
    }
  }
  prepare(sql: string): D1PreparedStatement {
    const owner = this
    const create = (params: unknown[] = []): object => ({
      sql, params, bind: (...values: unknown[]) => create(values),
      first: async () => owner.sql.prepare(sql).get(...params as never[]) ?? null,
      all: async () => ({ results: owner.sql.prepare(sql).all(...params as never[]) }),
      run: async () => ({ meta: { changes: Number(owner.sql.prepare(sql).run(...params as never[]).changes) } }),
    })
    return create() as D1PreparedStatement
  }
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const pending = statements as unknown as { sql: string; params: unknown[]; run(): Promise<D1Result> }[]
    if (pending.some((s) => s.sql.includes('INSERT OR IGNORE INTO live_fills') && s.params[0] === this.failFill)) {
      throw new Error('Injected accounting persistence outage')
    }
    if (this.failDispatch && pending.some((s) => s.sql.includes('INSERT INTO live_recovery_accounting_dispatches'))) {
      throw new Error('Injected dispatch receipt persistence outage')
    }
    this.sql.exec('BEGIN IMMEDIATE')
    try {
      const results = []
      for (const s of pending) results.push(await s.run())
      this.sql.exec('COMMIT')
      return results
    } catch (error) { this.sql.exec('ROLLBACK'); throw error }
  }
  env() { return { DB: this as unknown as D1Database, CANDIDATE_ACCOUNTING_TOKEN: TOKEN } }
  count(table: string): number { return Number(this.sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n) }
}

function command(side: 'BUY' | 'SELL'): VerifiedSpotFillAccountingInput {
  const id = side === 'BUY' ? 'buy-order' : 'sell-order'
  return {
    exchangeName: 'BITGET', exchangeAccountId: ACCOUNT, internalOrderId: id, correlationId: id,
    baseAsset: 'BTC', quoteAsset: 'USDT', rawResponseHash: 'b'.repeat(64),
    feeQuoteValue: asDecimalString(side === 'BUY' ? '1' : '0.2'),
    fill: { fillId: `fill-${id}`, tradeId: `trade-${id}`, exchangeOrderId: `exchange-${id}`,
      productId: 'BTC-USDT', side, price: asDecimalString(side === 'BUY' ? '50000' : '60000'),
      baseSize: asDecimalString(side === 'BUY' ? '0.01' : '0.004'),
      commission: asDecimalString(side === 'BUY' ? '1' : '0.2'), commissionAsset: 'USDT',
      tradeTime: side === 'BUY' ? '2026-10-04T01:00:00.000Z' : '2026-10-04T01:01:00.000Z',
      sequenceTimestamp: side === 'BUY' ? '2026-10-04T01:00:01.000Z' : '2026-10-04T01:01:01.000Z' },
    accounts: { baseInventoryAccountId: 'base-inventory', baseReservedAccountId: 'base-reserved',
      baseClearingAccountId: 'base-clearing', quoteAvailableAccountId: 'quote-available',
      quoteReservedAccountId: 'quote-reserved', quoteClearingAccountId: 'quote-clearing',
      feeExpenseAccountId: 'fee-expense', feeSourceAccountId: 'quote-available' },
  }
}


function settlement(accountingHash: string, overrides: object = {}) {
  return { reservationId: 'reservation-buy', fillId: 'fill-buy-order', accountingHash,
    terminalFill: true, availableAccountId: 'quote-available', reservedAccountId: 'quote-reserved',
    releaseJournalId: 'release-buy', correlationId: 'completion-buy', idempotencyKey: 'settle-buy',
    settledAt: '2026-10-04T01:02:00.000Z', ...overrides }
}
async function prepared() {
  const db = new SqliteD1()
  db.sql.prepare(`INSERT INTO reservations (reservation_id,exchange_account_id,order_id,asset,amount)
    VALUES ('reservation-buy',?,'buy-order','USDT','550')`).run(ACCOUNT)
  const input = command('BUY')
  input.accounts.feeSourceAccountId = 'quote-reserved'
  const accounted = await persistSpotFillAccountingVerified(db.env(), input)
  db.sql.prepare(`UPDATE live_orders SET state='FILLED',filled_base_quantity='0.01',
    filled_quote_value='500',raw_response_hash=? WHERE internal_order_id='buy-order'`).run('b'.repeat(64))
  db.sql.prepare(`INSERT INTO live_order_events (event_id,internal_order_id,previous_state,next_state,
    source,source_event_id,correlation_id,configuration_version,payload_hash,audit_event_hash,occurred_at)
    VALUES ('terminal-buy','buy-order','RECOVERY_REQUIRED','FILLED','exchange-rest','rest-buy',
    'terminal-buy','test',?,?,?)`).run('b'.repeat(64),'c'.repeat(64),'2026-10-04T01:01:00.000Z')
  return { db, accounted }
}

test('actual FIFO accounting, terminal reservation release and order event complete and replay without duplicate money entries', async () => {
  const { db, accounted } = await prepared()
  try {
    const input = settlement(accounted.accountingHash)
    const result = await persistReservationSettlement(db.env(), input)
    assert.equal(result.nextConsumedAmount, '501')
    assert.equal(result.releasedAmount, '49')
    assert.equal(result.nextStatus, 'RELEASED')
    assert.equal((await persistCompletedOrder(db.env(), ACCOUNT, 'buy-order')).status, 'COMPLETED')
    assert.equal((await persistReservationSettlement(db.env(), input)).status, 'REPLAYED')
    assert.equal((await persistCompletedOrder(db.env(), ACCOUNT, 'buy-order')).status, 'REPLAYED')
    assert.equal(db.count('ledger_journals'), 2)
    assert.equal(db.count('live_reservation_settlement_receipts'), 1)
    assert.equal(db.count('live_reservation_settlement_events'), 1)
    assert.equal(db.count('live_order_events'), 2)
    const order = db.sql.prepare(`SELECT state,settled FROM live_orders WHERE internal_order_id='buy-order'`).get()!
    assert.equal(order.state, 'SETTLED'); assert.equal(order.settled, 1)
  } finally { db.sql.close() }
})

test('missing, foreign, frozen, incorrect asset or type and aliased ledger accounts fail before release', async () => {
  for (const change of [
    `DELETE FROM ledger_accounts WHERE ledger_account_id='quote-available'`,
    `UPDATE ledger_accounts SET exchange_account_id='other-account' WHERE ledger_account_id='quote-available'`,
    `UPDATE ledger_accounts SET status='FROZEN' WHERE ledger_account_id='quote-available'`,
    `UPDATE ledger_accounts SET asset='ETH' WHERE ledger_account_id='quote-available'`,
    `UPDATE ledger_accounts SET account_type='RECONCILIATION_SUSPENSE' WHERE ledger_account_id='quote-available'`,
  ]) {
    const { db, accounted } = await prepared()
    try {
      db.sql.exec(change)
      await assert.rejects(persistReservationSettlement(db.env(), settlement(accounted.accountingHash)))
      assert.equal(db.count('ledger_journals'), 1)
      assert.equal(db.count('live_reservation_settlement_receipts'), 0)
    } finally { db.sql.close() }
  }
  const { db, accounted } = await prepared()
  try {
    await assert.rejects(persistReservationSettlement(db.env(), settlement(accounted.accountingHash,
      { availableAccountId: 'quote-reserved' })))
    await assert.rejects(persistReservationSettlement(db.env(), settlement(accounted.accountingHash,
      { terminalFill: 'false' })))
  } finally { db.sql.close() }
})

test('active reservation, missing observation, active order, wrong account and incomplete fill totals block completion', async () => {
  for (const change of [null,
    `DELETE FROM live_order_events`,
    `UPDATE live_orders SET state='OPEN' WHERE internal_order_id='buy-order'`,
    `UPDATE live_orders SET filled_base_quantity='0.02' WHERE internal_order_id='buy-order'`,
    `UPDATE live_orders SET filled_quote_value='501' WHERE internal_order_id='buy-order'`,
    `UPDATE live_order_events SET source='operator'`,
    `UPDATE live_orders SET pending_cancel=1 WHERE internal_order_id='buy-order'`,
  ]) {
    const { db, accounted } = await prepared()
    try {
      if (change) { await persistReservationSettlement(db.env(), settlement(accounted.accountingHash)); db.sql.exec(change) }
      await assert.rejects(persistCompletedOrder(db.env(), ACCOUNT, 'buy-order'))
      assert.equal(db.sql.prepare(`SELECT settled FROM live_orders WHERE internal_order_id='buy-order'`).get()!.settled, 0)
      await assert.rejects(persistCompletedOrder(db.env(), 'wrong-account', 'buy-order'))
    } finally { db.sql.close() }
  }
})

test('a failed completion event rolls back the order update and permits safe explicit retry', async () => {
  const { db, accounted } = await prepared()
  try {
    await persistReservationSettlement(db.env(), settlement(accounted.accountingHash))
    db.sql.exec(`CREATE TRIGGER fail_completion BEFORE INSERT ON live_order_events
      WHEN NEW.next_state='SETTLED' BEGIN SELECT RAISE(ABORT,'injected persistence outage'); END`)
    await assert.rejects(persistCompletedOrder(db.env(), ACCOUNT, 'buy-order'))
    assert.equal(db.sql.prepare(`SELECT state FROM live_orders WHERE internal_order_id='buy-order'`).get()!.state, 'FILLED')
    db.sql.exec('DROP TRIGGER fail_completion')
    assert.equal((await persistCompletedOrder(db.env(), ACCOUNT, 'buy-order')).status, 'COMPLETED')
    assert.equal(db.count('live_reservation_settlement_receipts'), 1)
  } finally { db.sql.close() }
})

test('changed evidence cannot be reported as a successful completion replay', async () => {
  const { db, accounted } = await prepared()
  try {
    await persistReservationSettlement(db.env(), settlement(accounted.accountingHash))
    await persistCompletedOrder(db.env(), ACCOUNT, 'buy-order')
    db.sql.exec(`UPDATE live_orders SET filled_base_quantity='0.02' WHERE internal_order_id='buy-order'`)
    await assert.rejects(persistCompletedOrder(db.env(), ACCOUNT, 'buy-order'))
    assert.equal(db.count('live_order_events'), 2)
  } finally { db.sql.close() }
})

test('reservation version drift aborts the entire release batch without a receipt or orphaned journal', async () => {
  const { db, accounted } = await prepared()
  try {
    const original = db.batch.bind(db)
    let drifted = false
    db.batch = async (statements) => {
      if (!drifted) {
        drifted = true
        db.sql.exec(`UPDATE reservations SET version=1 WHERE reservation_id='reservation-buy'`)
      }
      return original(statements)
    }
    await assert.rejects(persistReservationSettlement(db.env(), settlement(accounted.accountingHash)))
    assert.equal(db.count('ledger_journals'), 1)
    assert.equal(db.count('live_reservation_settlement_receipts'), 0)
    assert.equal(db.sql.prepare(`SELECT consumed_amount FROM reservations WHERE reservation_id='reservation-buy'`).get()!.consumed_amount, '0')
  } finally { db.sql.close() }
})

test('order drift between proof loading and commit produces neither a completion event nor a settled order', async () => {
  const { db, accounted } = await prepared()
  try {
    await persistReservationSettlement(db.env(), settlement(accounted.accountingHash))
    const original = db.batch.bind(db)
    db.batch = async (statements) => {
      db.sql.exec(`UPDATE live_orders SET state='RECOVERY_REQUIRED' WHERE internal_order_id='buy-order'`)
      return original(statements)
    }
    await assert.rejects(persistCompletedOrder(db.env(), ACCOUNT, 'buy-order'))
    assert.equal(db.count('live_order_events'), 1)
    assert.equal(db.sql.prepare(`SELECT settled FROM live_orders WHERE internal_order_id='buy-order'`).get()!.settled, 0)
  } finally { db.sql.close() }
})
