import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { ExchangeAccountCoordinator } from '../src/live/observed-account-coordinator.ts'
import { FillAccountingSerialQueue } from '../src/live/fill-accounting-serialization.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import { buildReservationJournal } from '../src/live/ledger.ts'
import { recordAuthorizationDecision, evaluateAuthorization } from '../src/live/authorization.ts'
import { persistSpotFillAccountingVerified, type VerifiedSpotFillAccountingInput } from '../src/live/fill-accounting-service.ts'
import { persistReservationSettlement } from '../src/live/reservation-settlement-store.ts'
const ACCOUNT = 'bitget-account-ref'
const TOKEN = 'local-test-completion-token'
class SqliteD1 {
  readonly sql = new DatabaseSync(':memory:')
  failFill: string | null = null
  failDispatch = false
  constructor() {
    this.sql.exec('PRAGMA foreign_keys=ON')
    const root = new URL('../migrations/', import.meta.url)
    for (const file of fs.readdirSync(root).filter((name) => (/^(00[3-9]|01\d|02\d|030)_.*\.sql$/.test(name) || name === '033_live_zero_fill_reservation_release.sql')).sort()) {
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



async function prepared(options: { type?: string; age?: number; audience?: string; scope?: string; expiredRole?: boolean } = {}) {
  const db = new SqliteD1()
  const now = Date.now()
  const issuedAt = new Date(now - 600_000).toISOString()
  const expiresAt = new Date(now + 300_000).toISOString()
  const evaluatedAt = new Date(now - (options.age ?? 10_000)).toISOString()
  const scope = options.scope ?? ACCOUNT
  db.sql.prepare(`INSERT INTO live_actor_roles (actor_id,role,scope_type,scope_key,granted_by,granted_at,expires_at)
    VALUES ('reviewer','RISK_OPERATOR','ACCOUNT',?,'fixture',?,?)`).run(scope, issuedAt,
      options.expiredRole ? new Date(now - 1000).toISOString() : null)
  const session = { stepUpSessionId: 'completion-session', actorId: 'reviewer', assuranceLevel: 'AAL2' as const,
    audience: options.audience ?? 'operations', issuedAt, expiresAt, revokedAt: null }
  db.sql.prepare(`INSERT INTO live_step_up_sessions (step_up_session_id,actor_id,authentication_method,
    assurance_level,audience,issued_at,expires_at,session_hash) VALUES (?,?,'fixture',?,?,?,?,?)`)
    .run(session.stepUpSessionId,session.actorId,session.assuranceLevel,session.audience,issuedAt,expiresAt,'d'.repeat(64))
  const request = { actorId: 'reviewer', action: 'RUN_RECONCILIATION' as const,
    resourceType: options.type ?? 'ORDER_COMPLETION', resourceId: 'buy-order', exchangeName: 'BITGET',
    exchangeAccountId: ACCOUNT, resourceOwnerActorId: null, evaluatedAt,
    roles: [{ role: 'RISK_OPERATOR' as const, scopeType: 'ACCOUNT' as const, scopeKey: ACCOUNT, expiresAt: null, revokedAt: null }],
    stepUpSession: session }
  await recordAuthorizationDecision(db.env(), { authorizationEventId: 'completion-auth', request,
    decision: evaluateAuthorization(request), correlationId: 'completion-review', auditEventHash: 'c'.repeat(64) })
  db.sql.prepare(`UPDATE live_orders SET state='CANCELLED',filled_base_quantity='0',filled_quote_value='0',
    raw_response_hash=? WHERE internal_order_id='buy-order'`).run('b'.repeat(64))
  db.sql.prepare(`INSERT INTO live_order_events (event_id,internal_order_id,previous_state,next_state,source,
    source_event_id,correlation_id,configuration_version,payload_hash,audit_event_hash,occurred_at)
    VALUES ('terminal-buy','buy-order','RECOVERY_REQUIRED','CANCELLED','exchange-rest','rest-buy',
    'terminal-buy','test',?,?,?)`).run('b'.repeat(64),'c'.repeat(64),issuedAt)
  db.sql.prepare(`INSERT INTO reservations (reservation_id,exchange_account_id,order_id,asset,amount)
    VALUES ('reservation-buy',?,'buy-order','USDT','550')`).run(ACCOUNT)
  const reserve = buildReservationJournal({ journalId:'reserve-buy',exchangeAccountId:ACCOUNT,orderId:'buy-order',
    correlationId:'risk-admission',idempotencyKey:'reserve-buy',asset:'USDT',amount:asDecimalString('550'),
    availableAccountId:'quote-available',reservedAccountId:'quote-reserved' })
  db.sql.prepare(`INSERT INTO ledger_journals (journal_id,exchange_account_id,event_type,reference_type,
    reference_id,correlation_id,idempotency_key) VALUES (?,?,?,?,?,?,?)`)
    .run(reserve.journalId,reserve.exchangeAccountId,reserve.eventType,reserve.referenceType,
      reserve.referenceId,reserve.correlationId,reserve.idempotencyKey)
  for (const e of reserve.entries) db.sql.prepare(`INSERT INTO ledger_entries
    (entry_id,journal_id,ledger_account_id,asset,direction,amount) VALUES (?,?,?,?,?,?)`)
    .run(e.entryId,reserve.journalId,e.ledgerAccountId,e.asset,e.direction,e.amount)
  const coordinator = Object.assign(Object.create(ExchangeAccountCoordinator.prototype), {
    state: { id: { name: ACCOUNT } }, env: db.env(), accountingQueue: new FillAccountingSerialQueue(),
  }) as ExchangeAccountCoordinator
  return { db, coordinator }
}
function request(overrides: object = {}, token = TOKEN) {
  return new Request('https://coordinator/candidate/orders/complete', { method: 'POST',
    headers: { 'X-Candidate-Accounting-Token': token },
    body: JSON.stringify({ orderId:'buy-order',authorizationEventId:'completion-auth',...overrides }) })
}

test('reviewed zero-fill cancellation releases the actual reserve, completes once and safely replays', async () => {
  const { db, coordinator } = await prepared()
  try {
    const first = await coordinator.fetch(request())
    assert.equal(first.status, 201, JSON.stringify(await first.json()))
    assert.equal((await coordinator.fetch(request())).status, 200)
    db.sql.exec(fs.readFileSync(new URL('../migrations/033_live_zero_fill_reservation_release.sql',import.meta.url),'utf8'))
    assert.equal(db.count('ledger_journals'), 2)
    assert.equal(db.count('live_zero_fill_reservation_releases'), 1)
    assert.equal(db.count('live_fills'), 0)
    assert.equal(db.count('live_order_events'), 2)
    const r = db.sql.prepare(`SELECT status,consumed_amount,version FROM reservations`).get()!
    assert.equal(r.status,'RELEASED'); assert.equal(r.consumed_amount,'0'); assert.equal(r.version,1)
    assert.equal(db.sql.prepare(`SELECT state FROM live_orders WHERE internal_order_id='buy-order'`).get()!.state,'SETTLED')
    assert.throws(() => db.sql.exec(`DELETE FROM live_zero_fill_reservation_releases`))
    assert.throws(() => db.sql.exec(`UPDATE live_zero_fill_reservation_releases SET released_amount='999'`))
  } finally { db.sql.close() }
})

test('accounting approval, expired or future review, wrong audience, revoked session and current role denial cannot release', async () => {
  for (const options of [{ type:'RECOVERY_ACCOUNTING_PLAN' }, { age:301_000 }, { age:-10_000 },
    { audience:'trading' }, { scope:'other-account' }, { expiredRole:true }]) {
    const { db, coordinator } = await prepared(options)
    try {
      assert.equal((await coordinator.fetch(request())).status,403)
      assert.equal(db.count('ledger_journals'),1)
      assert.equal(db.count('live_zero_fill_reservation_releases'),0)
    } finally { db.sql.close() }
  }
  for (const change of [
    `UPDATE live_step_up_sessions SET revoked_at='2026-10-04T01:00:00.000Z'`,
    `UPDATE live_actor_roles SET revoked_at='2026-10-04T01:00:00.000Z'`,
    `UPDATE live_actor_roles SET expires_at='not-a-time'`,
  ]) {
    const { db, coordinator } = await prepared()
    try { db.sql.exec(change); assert.equal((await coordinator.fetch(request())).status,403) }
    finally { db.sql.close() }
  }
})

test('authentication, named coordinator scope and identifier-only payloads fail closed', async () => {
  const { db, coordinator } = await prepared()
  try {
    assert.equal((await coordinator.fetch(request({},'wrong'))).status,401)
    for (const body of [{ accountId:ACCOUNT },{ terminalFill:true },{ evaluatedAt:new Date().toISOString() },{ amount:'550' }]) {
      assert.equal((await coordinator.fetch(request(body))).status,400)
    }
    Object.assign(coordinator,{ state:{ id:{ name:'other-account' } } })
    assert.equal((await coordinator.fetch(request())).status,403)
    Object.assign(coordinator,{ state:{ id:{} } })
    assert.equal((await coordinator.fetch(request())).status,503)
    assert.equal(db.count('ledger_journals'),1)
  } finally { db.sql.close() }
})

test('concurrent completion commands share the account queue and post one release', async () => {
  const { db, coordinator } = await prepared()
  try {
    const results = await Promise.all([coordinator.fetch(request()),coordinator.fetch(request())])
    assert.deepEqual(results.map((r) => r.status).sort(),[200,201])
    assert.equal(db.count('live_zero_fill_reservation_releases'),1)
    assert.equal(db.count('ledger_journals'),2)
  } finally { db.sql.close() }
})

test('revocation while a command waits is rechecked before release', async () => {
  const { db, coordinator } = await prepared()
  try {
    let release!: () => void
    const block = new Promise<void>((resolve) => { release=resolve })
    const queue = (coordinator as any).accountingQueue as FillAccountingSerialQueue
    const held = queue.run(async () => block)
    let entered!: () => void
    const queued = new Promise<void>((resolve) => { entered=resolve })
    const run=queue.run.bind(queue)
    queue.run=(operation) => { const result=run(operation); entered(); return result }
    const pending = coordinator.fetch(request())
    await queued
    assert.equal(queue.pendingCount,2)
    db.sql.exec(`UPDATE live_actor_roles SET revoked_at='2026-10-04T01:00:00.000Z'`)
    release(); await held
    assert.equal((await pending).status,403)
    assert.equal(db.count('ledger_journals'),1)
  } finally { db.sql.close() }
})

test('receipt insertion failure rolls back reservation and release journal', async () => {
  const { db, coordinator } = await prepared()
  try {
    db.sql.exec(`CREATE TRIGGER fail_release BEFORE INSERT ON live_zero_fill_reservation_releases
      BEGIN SELECT RAISE(ABORT,'injected receipt outage'); END`)
    assert.equal((await coordinator.fetch(request())).status,500)
    assert.equal(db.count('ledger_journals'),1)
    assert.equal(db.sql.prepare(`SELECT status FROM reservations`).get()!.status,'ACTIVE')
    db.sql.exec('DROP TRIGGER fail_release')
    assert.equal((await coordinator.fetch(request())).status,201)
    assert.equal(db.count('ledger_journals'),2)
  } finally { db.sql.close() }
})

test('failure after release but before completion can resume without posting another release', async () => {
  const { db, coordinator } = await prepared()
  try {
    db.sql.exec(`CREATE TRIGGER fail_completion BEFORE INSERT ON live_order_events WHEN NEW.next_state='SETTLED'
      BEGIN SELECT RAISE(ABORT,'injected event outage'); END`)
    assert.equal((await coordinator.fetch(request())).status,500)
    assert.equal(db.count('ledger_journals'),2)
    assert.equal(db.sql.prepare(`SELECT state FROM live_orders WHERE internal_order_id='buy-order'`).get()!.state,'CANCELLED')
    db.sql.exec('DROP TRIGGER fail_completion')
    assert.equal((await coordinator.fetch(request())).status,201)
    assert.equal(db.count('ledger_journals'),2)
  } finally { db.sql.close() }
})

test('unbacked reservation, frozen ledger, partial consumption and nonterminal observation cannot release', async () => {
  for (const change of [
    `UPDATE ledger_journals SET status='REVERSED'`,
    `UPDATE ledger_accounts SET status='FROZEN' WHERE ledger_account_id='quote-available'`,
    `UPDATE reservations SET status='PARTIALLY_CONSUMED',consumed_amount='1'`,
    `UPDATE live_orders SET state='CANCEL_PENDING' WHERE internal_order_id='buy-order'`,
    `UPDATE live_orders SET pending_cancel=1 WHERE internal_order_id='buy-order'`,
    `UPDATE live_order_events SET source='operator'`,
  ]) {
    const { db, coordinator } = await prepared()
    try {
      db.sql.exec(change)
      assert.equal((await coordinator.fetch(request())).status,409)
      assert.equal(db.count('ledger_journals'),1)
    } finally { db.sql.close() }
  }
})

test('late provider quantity change aborts release at the database constraint', async () => {
  const { db, coordinator } = await prepared()
  try {
    const original=db.batch.bind(db)
    db.batch=async (statements) => {
      db.sql.exec(`UPDATE live_orders SET filled_base_quantity='0.01' WHERE internal_order_id='buy-order'`)
      return original(statements)
    }
    assert.equal((await coordinator.fetch(request())).status,500)
    assert.equal(db.count('ledger_journals'),1)
    assert.equal(db.count('live_zero_fill_reservation_releases'),0)
  } finally { db.sql.close() }
})

test('a reversed release journal cannot be replayed as successful completion', async () => {
  const { db, coordinator } = await prepared()
  try {
    assert.equal((await coordinator.fetch(request())).status,201)
    db.sql.exec(`UPDATE ledger_journals SET status='REVERSED' WHERE event_type='FUNDS_RESERVATION_RELEASED'`)
    assert.equal((await coordinator.fetch(request())).status,409)
  } finally { db.sql.close() }
})

test('the same command finalizes a filled order only after actual fill settlement', async () => {
  const { db, coordinator } = await prepared()
  try {
    const fill=command('BUY'); fill.accounts.feeSourceAccountId='quote-reserved'
    const accounted=await persistSpotFillAccountingVerified(db.env(),fill)
    db.sql.exec(`UPDATE live_orders SET state='FILLED',filled_base_quantity='0.01',filled_quote_value='500'
      WHERE internal_order_id='buy-order'; UPDATE live_order_events SET next_state='FILLED'`)
    assert.equal((await coordinator.fetch(request())).status,409)
    await persistReservationSettlement(db.env(), { reservationId:'reservation-buy',fillId:fill.fill.fillId,
      accountingHash:accounted.accountingHash,terminalFill:true,availableAccountId:'quote-available',
      reservedAccountId:'quote-reserved',releaseJournalId:'fill-release',correlationId:'fill-settle',
      idempotencyKey:'fill-settle',settledAt:'2026-10-04T01:02:00.000Z' })
    assert.equal((await coordinator.fetch(request())).status,201)
    assert.equal(db.count('live_zero_fill_reservation_releases'),0)
    assert.equal((await coordinator.fetch(request())).status,200)
    db.sql.exec(`UPDATE ledger_journals SET status='REVERSED' WHERE event_type='SPOT_FILL_POSTED'`)
    assert.equal((await coordinator.fetch(request())).status,409)
  } finally { db.sql.close() }
})

test('undeclared oversized JSON stream is cancelled before the full body is buffered', async () => {
  const { db, coordinator } = await prepared()
  try {
    let reads=0, cancelled=false
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      reads++; controller.enqueue(new Uint8Array(128*1024).fill(32))
    }, cancel() { cancelled=true } })
    const req=new Request('https://coordinator/candidate/orders/complete', {
      method:'POST',headers:{ 'X-Candidate-Accounting-Token':TOKEN },body:stream,duplex:'half',
    } as RequestInit)
    assert.equal((await coordinator.fetch(req)).status,400)
    assert.equal(cancelled,true)
    assert.ok(reads <= 6)
    assert.equal(db.count('ledger_journals'),1)
  } finally { db.sql.close() }
})

test('a ledger frozen after preflight aborts release atomically', async () => {
  const { db, coordinator } = await prepared()
  try {
    const original=db.batch.bind(db)
    db.batch=async (statements) => {
      db.sql.exec(`UPDATE ledger_accounts SET status='FROZEN' WHERE ledger_account_id='quote-available'`)
      return original(statements)
    }
    assert.equal((await coordinator.fetch(request())).status,500)
    assert.equal(db.count('ledger_journals'),1)
    assert.equal(db.count('live_zero_fill_reservation_releases'),0)
  } finally { db.sql.close() }
})
