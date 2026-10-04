import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { discoverScheduledRecovery } from '../src/live/scheduled-recovery-discovery.ts'

function fixture(count = 1, provider = 'BITGET') {
  const db = new DatabaseSync(':memory:')
  for (const name of ['007_live_exchange_projections.sql', '009_live_queue_delivery.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  }
  db.prepare(`INSERT INTO live_exchange_accounts (exchange_account_id, exchange_name, external_account_ref_hash, status)
    VALUES ('account-1', ?, 'account-hash', 'READ_ONLY')`).run(provider)
  for (let i = 0; i < count; i += 1) {
    db.prepare(`INSERT INTO live_orders (
      internal_order_id, exchange_account_id, client_order_id, product_id, side, order_type, state,
      requested_base_quantity, configuration_version, created_at, updated_at
    ) VALUES (?, 'account-1', ?, 'BTC-USDT', 'BUY', 'LIMIT', 'RECOVERY_REQUIRED', '0.01', 'v1', ?, ?)`)
      .run(`order-${String(i).padStart(3, '0')}`, `client-${i}`, '2026-10-03T00:00:00.000Z', '2026-10-03T00:01:00.000Z')
  }
  const DB = {
    prepare(sql: string) {
      return { bind(...values: (string | number | null)[]) {
        const statement = db.prepare(sql)
        return {
          async first() { return statement.get(...values) ?? null },
          async all() { return { results: statement.all(...values) } },
          async run() { return { meta: { changes: statement.run(...values).changes } } },
        }
      } }
    },
  } as unknown as D1Database
  const env = { DB, LIVE_RECOVERY_DISCOVERY_ENABLED: 'true', LIVE_RECOVERY_ACCOUNT_IDS: '["account-1"]' }
  return { db, env, now: Date.parse('2026-10-04T00:00:00.000Z') }
}

test('disabled recovery never queries storage or provider authority', async () => {
  const result = await discoverScheduledRecovery({ DB: {} as D1Database }, 0)
  assert.equal(result.status, 'DISABLED')
})

test('cron recovery persists GET-only plans through the existing outbox, then restart redelivery is empty', async () => {
  const { db, env, now } = fixture()
  const before = db.prepare('SELECT * FROM live_orders').get()
  assert.equal((await discoverScheduledRecovery(env, now)).registered, 1)
  const row = db.prepare('SELECT * FROM live_queue_messages').get()!
  const payload = JSON.parse(String(row.payload_json))
  assert.equal(payload.plan.instruction.method, 'GET')
  assert.equal(payload.plan.instruction.expectedClientOrderId, 'client-0')
  assert.equal(payload.plan.providerMutationAllowed, false)
  assert.equal(payload.plan.automaticRetryAllowed, false)
  assert.equal((await discoverScheduledRecovery(env, now + 300000)).registered, 0)
  assert.deepEqual(db.prepare('SELECT * FROM live_orders').get(), before)
  db.close()
})

test('bounded discovery progresses past already queued orders instead of starving later work', async () => {
  const { db, env, now } = fixture(105)
  assert.equal((await discoverScheduledRecovery(env, now)).registered, 100)
  assert.equal((await discoverScheduledRecovery(env, now + 300000)).registered, 5)
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_queue_messages').get()!.n, 105)
  db.close()
})

test('concurrent discovery cannot duplicate a queue record or financial mutation', async () => {
  const { db, env, now } = fixture()
  const results = await Promise.all([discoverScheduledRecovery(env, now), discoverScheduledRecovery(env, now)])
  assert.equal(results.reduce((n, r) => n + r.registered, 0), 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_queue_messages').get()!.n, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_fills').get()!.n, 0)
  db.close()
})

test('BTCC never falls back to the Bitget recovery route', async () => {
  const { db, env, now } = fixture(1, 'BTCC')
  await assert.rejects(discoverScheduledRecovery(env, now), /provider is unsupported/)
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_queue_messages').get()!.n, 0)
  db.close()
})

test('missing identity persists manual review and never an inferred submit', async () => {
  const { db, env, now } = fixture()
  db.exec('UPDATE live_orders SET client_order_id = NULL')
  assert.equal((await discoverScheduledRecovery(env, now)).manualReview, 1)
  const payload = JSON.parse(String(db.prepare('SELECT payload_json FROM live_queue_messages').get()!.payload_json))
  assert.equal(payload.plan.instruction, null)
  assert.equal(payload.plan.status, 'MANUAL_REVIEW_REQUIRED')
  db.close()
})

test('changed persisted evidence becomes new discovery work without replaying the old plan', async () => {
  const { db, env, now } = fixture()
  await discoverScheduledRecovery(env, now)
  db.exec("UPDATE live_orders SET exchange_order_id = 'acknowledged-order'")
  assert.equal((await discoverScheduledRecovery(env, now + 300000)).registered, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_queue_messages').get()!.n, 2)
  db.close()
})

test('invalid scope and unavailable D1 fail closed', async () => {
  const { db, env, now } = fixture()
  for (const value of ['', '[]', '["account-1","account-1"]', '[null]']) {
    await assert.rejects(discoverScheduledRecovery({ ...env, LIVE_RECOVERY_ACCOUNT_IDS: value }, now), /allowlist/)
  }
  await assert.rejects(discoverScheduledRecovery({ ...env, DB: { prepare() { throw new Error('D1 unavailable') } } as unknown as D1Database }, now))
  assert.equal(db.prepare('SELECT count(*) AS n FROM live_queue_messages').get()!.n, 0)
  db.close()
})
