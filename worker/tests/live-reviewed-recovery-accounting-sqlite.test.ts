import { routeReviewedOperation } from '../src/live/reviewed-operations-gateway.ts'
import { sha256Hex } from '../src/live/operator-read-auth.ts'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { ExchangeAccountCoordinator } from '../src/live/observed-account-coordinator.ts'
import { FillAccountingSerialQueue } from '../src/live/fill-accounting-serialization.ts'
import { asDecimalString } from '../src/live/decimal.ts'
import { persistTimeBoundRecoveryAccountingApproval } from '../src/live/recovery-accounting-approval-validity.ts'
import { calculateBitgetRecoveryAccountingPlanHash } from '../src/live/recovery-accounting-plan-integrity.ts'
import type { VerifiedSpotFillAccountingInput } from '../src/live/fill-accounting-service.ts'

const ACCOUNT = 'bitget-account-ref'
const TOKEN = 'local-test-accounting-token'
const ROUTE = 'https://coordinator/candidate/recovery-accounting/dispatch'

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

async function approve(db: SqliteD1, options: { expired?: boolean; actorId?: string; suffix?: string; wrongAsset?: boolean } = {}) {
  const suffix = options.suffix ?? '1'
  const now = Date.now() - (options.expired ? 600_000 : 10_000)
  const evaluatedAt = new Date(now).toISOString()
  const hashable = { exchangeName: 'BITGET' as const, exchangeAccountId: ACCOUNT, productId: 'BTC-USDT',
    recoverySnapshotHash: 'a'.repeat(64), commandCount: 2,
    commands: [command('BUY'), command('SELL')].map((c) => options.wrongAsset ? { ...c, baseAsset: 'ETH' } : c),
    accountingEvidenceReady: true as const, automaticallyDispatched: false as const,
    providerMutationAllowed: false as const, reservationApplied: false as const, executionAllowed: false as const }
  const actorId = options.actorId ?? 'risk-reviewer'
  db.sql.prepare(`INSERT OR IGNORE INTO live_actor_roles
    (actor_id,role,scope_type,scope_key,granted_by,granted_at)
    VALUES (?,'RISK_OPERATOR','ACCOUNT',?,'local-fixture',?)`).run(actorId, ACCOUNT, evaluatedAt)
  db.sql.prepare(`INSERT INTO live_step_up_sessions (step_up_session_id,actor_id,authentication_method,
    assurance_level,audience,issued_at,expires_at,session_hash) VALUES (?,?,'fixture','AAL2','operations',?,?,?)`)
    .run(`step-up-${suffix}`, actorId, new Date(now - 60_000).toISOString(),
      new Date(now + 300_000).toISOString(), suffix.padStart(64, '0'))
  return persistTimeBoundRecoveryAccountingApproval(db.env(), {
    planId: 'plan-1', plan: { ...hashable, planHash: await calculateBitgetRecoveryAccountingPlanHash(hashable) },
    planPreparedByActorId: 'planner', actorId, approvalEventId: `approval-${suffix}`,
    authorizationEventId: `authorization-${suffix}`, correlationId: 'review-1', auditEventHash: 'c'.repeat(64),
    evaluatedAt, roles: [{ role: 'RISK_OPERATOR', scopeType: 'ACCOUNT', scopeKey: ACCOUNT, expiresAt: null, revokedAt: null }],
    stepUpSession: { stepUpSessionId: `step-up-${suffix}`, actorId, assuranceLevel: 'AAL2', audience: 'operations',
      issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 300_000).toISOString(), revokedAt: null },
  })
}

// Exercise the actual internal fetch handler without emulating Cloudflare's
// constructor/SQL runtime. All financial projection and approval stores use real SQLite.
function coordinator(db: SqliteD1, name: string | undefined = ACCOUNT): ExchangeAccountCoordinator {
  return Object.assign(Object.create(ExchangeAccountCoordinator.prototype), {
    state: { id: { name } }, env: db.env(), accountingQueue: new FillAccountingSerialQueue(),
  }) as ExchangeAccountCoordinator
}

function request(dispatchId = 'dispatch-1', body: object = {}, token = TOKEN): Request {
  return new Request(ROUTE, { method: 'POST', headers: { 'X-Candidate-Accounting-Token': token },
    body: JSON.stringify({ dispatchId, planId: 'plan-1', approvalEventId: 'approval-1', ...body }) })
}

test('reviewed coordinator posts recovered buys and sells through real FIFO stores and immutable dispatch evidence', async () => {
  const db = new SqliteD1()
  try {
    assert.equal((await approve(db)).approved, true)
    const c = coordinator(db)
    const response = await c.fetch(request())
    const body = await response.json() as any
    assert.equal(response.status, 201, JSON.stringify(body))
    assert.equal(body.dispatch.status, 'COMPLETED')
    assert.equal(body.dispatch.completedCommandCount, 2)
    assert.equal(body.dispatch.receipts[1].positionQuantity, '0.006')
    assert.equal(body.dispatch.receipts[1].cumulativeRealizedPnlQuote, '39.4')
    assert.equal(db.count('live_fill_accounting_receipts'), 2)
    assert.equal(db.count('ledger_journals'), 2)
    assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 1)
    assert.equal(db.count('live_recovery_accounting_dispatch_receipts'), 2)
    assert.equal(body.executionAllowed, false)
    assert.equal(body.reservationApplied, false)
    assert.equal(body.providerMutationAllowed, false)
    assert.equal((await c.fetch(request('dispatch-2'))).status, 409)
    assert.equal(db.count('live_fill_accounting_receipts'), 2)
  } finally { db.sql.close() }
})

test('authentication, named account scope and identifier-only input deny before creating an attempt', async () => {
  const db = new SqliteD1()
  try {
    await approve(db)
    assert.equal((await coordinator(db).fetch(request('bad-auth', {}, 'wrong'))).status, 401)
    const unnamed = coordinator(db, undefined)
    Object.assign(unnamed, { state: { id: {} } })
    assert.equal((await unnamed.fetch(request())).status, 503)
    assert.equal((await coordinator(db, 'different-account').fetch(request())).status, 409)
    for (const body of [{ exchangeAccountId: ACCOUNT }, { evaluatedAt: '2026-10-04T01:00:00.000Z' }, { commands: [] }]) {
      assert.equal((await coordinator(db).fetch(request('injected', body))).status, 400)
    }
    assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 0)
    assert.equal(db.count('live_fills'), 0)
  } finally { db.sql.close() }
})

test('expired approval and self-approval cannot reach FIFO accounting', async () => {
  for (const options of [{ expired: true }, { actorId: 'planner' }]) {
    const db = new SqliteD1()
    try {
      await approve(db, options)
      assert.equal((await coordinator(db).fetch(request())).status, 403)
      assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 0)
      assert.equal(db.count('live_fills'), 0)
    } finally { db.sql.close() }
  }
})

test('concurrent reviewed requests share the account queue and claim exactly one attempt', async () => {
  const db = new SqliteD1()
  try {
    await approve(db)
    const c = coordinator(db)
    const responses = await Promise.all([c.fetch(request('one')), c.fetch(request('two'))])
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409])
    assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 1)
    assert.equal(db.count('ledger_journals'), 2)
  } finally { db.sql.close() }
})

test('second fill failure persists partial evidence; restart requires fresh independent approval and safely replays first receipt', async () => {
  const db = new SqliteD1()
  try {
    await approve(db)
    db.failFill = 'fill-sell-order'
    const failed = await coordinator(db).fetch(request())
    assert.equal(failed.status, 409)
    assert.equal((await failed.json() as any).dispatch.status, 'PARTIAL')
    assert.equal(db.count('live_fill_accounting_receipts'), 1)
    db.failFill = null
    const restarted = coordinator(db)
    assert.equal((await restarted.fetch(request('resume-same-approval'))).status, 409)
    await approve(db, { suffix: '2' })
    const resumed = await restarted.fetch(request('resume', { approvalEventId: 'approval-2' }))
    const body = await resumed.json() as any
    assert.equal(resumed.status, 201, JSON.stringify(body))
    assert.equal(body.dispatch.receipts[0].status, 'REPLAYED')
    assert.equal(body.dispatch.receipts[1].status, 'PROJECTED')
    assert.equal(body.attempt.predecessorAttemptId, 'dispatch-1')
    assert.equal(db.count('live_fill_accounting_receipts'), 2)
    assert.equal(db.count('ledger_journals'), 2)
  } finally { db.sql.close() }
})

test('revoked reviewer role or step-up session is reloaded before the immutable attempt claim', async () => {
  for (const revoke of ["UPDATE live_actor_roles SET revoked_at = ?", "UPDATE live_step_up_sessions SET revoked_at = ?"]) {
    const db = new SqliteD1()
    try {
      await approve(db)
      db.sql.prepare(revoke).run(new Date().toISOString())
      assert.equal((await coordinator(db).fetch(request())).status, 403)
      assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 0)
      assert.equal(db.count('ledger_journals'), 0)
    } finally { db.sql.close() }
  }
})

test('authority is rechecked after waiting for the shared account queue', async () => {
  const db = new SqliteD1()
  try {
    await approve(db)
    const c = coordinator(db)
    let release!: () => void
    const queue = (c as unknown as { accountingQueue: FillAccountingSerialQueue }).accountingQueue
    const blocker = queue.run(() => new Promise<void>((resolve) => { release = resolve }))
    await Promise.resolve()
    const waiting = c.fetch(request())
    db.sql.prepare('UPDATE live_actor_roles SET revoked_at = ?').run(new Date().toISOString())
    release()
    await blocker
    assert.equal((await waiting).status, 403)
    assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 0)
  } finally { db.sql.close() }
})

test('reviewed commands cannot target another account ledger/order or a frozen ledger', async () => {
  for (const sql of [
    "UPDATE ledger_accounts SET exchange_account_id = 'different-account' WHERE ledger_account_id = 'quote-reserved'",
    "UPDATE ledger_accounts SET status = 'FROZEN' WHERE ledger_account_id = 'quote-reserved'",
    "UPDATE ledger_accounts SET asset = 'ETH' WHERE ledger_account_id = 'base-inventory'",
    "UPDATE live_orders SET exchange_order_id = 'different-provider-order' WHERE internal_order_id = 'sell-order'",
  ]) {
    const db = new SqliteD1()
    try {
      await approve(db)
      db.sql.exec(sql)
      assert.equal((await coordinator(db).fetch(request())).status, 403)
      assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 0)
      assert.equal(db.count('live_fills'), 0)
    } finally { db.sql.close() }
  }
})

test('product identity cannot be rebound to another base asset even with matching ledger ownership and a valid plan hash', async () => {
  const db = new SqliteD1()
  try {
    await approve(db, { wrongAsset: true })
    db.sql.exec("UPDATE ledger_accounts SET asset = 'ETH' WHERE asset = 'BTC'")
    assert.equal((await coordinator(db).fetch(request())).status, 403)
    assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 0)
    assert.equal(db.count('live_fills'), 0)
  } finally { db.sql.close() }
})

test('interruption after FIFO commits leaves an orphan claim; fresh review resumes with receipt replay and no duplicate fills', async () => {
  const db = new SqliteD1()
  try {
    await approve(db)
    db.failDispatch = true
    assert.equal((await coordinator(db).fetch(request())).status, 500)
    assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 1)
    assert.equal(db.count('live_recovery_accounting_dispatches'), 0)
    assert.equal(db.count('ledger_journals'), 2)
    db.failDispatch = false
    const restarted = coordinator(db)
    assert.equal((await restarted.fetch(request('unreviewed-resume'))).status, 409)
    await approve(db, { suffix: '2' })
    const response = await restarted.fetch(request('reviewed-resume', { approvalEventId: 'approval-2' }))
    const body = await response.json() as any
    assert.equal(response.status, 201, JSON.stringify(body))
    assert.deepEqual(body.dispatch.receipts.map((r: { status: string }) => r.status), ['REPLAYED', 'REPLAYED'])
    assert.equal(db.count('live_fills'), 2)
    assert.equal(db.count('ledger_journals'), 2)
    assert.equal(db.count('live_recovery_accounting_dispatch_attempts'), 2)
  } finally { db.sql.close() }
})


test('private operator ingress dispatches through the existing real reviewed recovery authority',async()=>{
  const db=new SqliteD1()
  try{
    await approve(db)
    const c=coordinator(db);let calls=0
    const env={...db.env(),OPERATOR_API_KEY_HASHES:JSON.stringify({'risk-reviewer':await sha256Hex('fixture-key')}),
      EXCHANGE_ACCOUNT_COORDINATOR:{idFromName(name:string){assert.equal(name,ACCOUNT);return{name}},
        get(){return{fetch(r:Request){calls++;assert.equal(r.headers.get('X-API-Key'),null);return c.fetch(r)}}}} as unknown as DurableObjectNamespace}
    const call=()=>new Request('https://private/reviewed/recovery-accounting/dispatch',{method:'POST',
      headers:{'X-Operator-Id':'risk-reviewer','X-API-Key':'fixture-key'},
      body:JSON.stringify({dispatchId:'dispatch-1',planId:'plan-1',approvalEventId:'approval-1'})})
    assert.equal((await routeReviewedOperation(call(),env)).status,201)
    assert.equal(db.count('live_fill_accounting_receipts'),2)
    assert.equal((await routeReviewedOperation(call(),env)).status,409)
    assert.equal(calls,2);assert.equal(db.count('live_fill_accounting_receipts'),2)
  }finally{db.sql.close()}
})
