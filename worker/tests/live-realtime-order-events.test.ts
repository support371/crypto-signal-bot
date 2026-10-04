import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { readAuthorizedOrderEvents, type RealtimeReadPrincipal } from '../src/routes/realtime-order-events.ts'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../migrations/007_live_exchange_projections.sql', import.meta.url), 'utf8'))
  const now = '2026-10-04T00:00:00.000Z'
  for (const id of ['account-a', 'account-b']) {
    db.prepare(`INSERT INTO live_exchange_accounts (exchange_account_id, exchange_name, external_account_ref_hash)
      VALUES (?, 'BITGET', ?)`).run(id, id)
    db.prepare(`INSERT INTO live_orders (internal_order_id, exchange_account_id, product_id, side, order_type,
      state, requested_base_quantity, configuration_version, created_at, updated_at)
      VALUES (?, ?, 'BTC-USDT', 'BUY', 'LIMIT', 'FILLED', '0.01', 'v1', ?, ?)`).run(`order-${id}`, id, now, now)
    for (const state of ['SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_REQUESTED', 'CANCEL_PENDING',
      'CANCELLED', 'REJECTED', 'RECOVERY_REQUIRED', 'FAILED', 'RISK_REJECTED']) {
      db.prepare(`INSERT INTO live_order_events (event_id, internal_order_id, next_state, source, correlation_id,
        configuration_version, payload_hash, audit_event_hash, occurred_at)
        VALUES (?, ?, ?, 'exchange-rest', 'correlation', 'v1', ?, ?, ?)`)
        .run(`${id}:${state}`, `order-${id}`, state, 'a'.repeat(64), 'b'.repeat(64), now)
    }
  }
  const DB = { prepare(sql: string) { const stmt = db.prepare(sql); let values: (string | number)[] = []
    const result = { bind(...args: (string | number)[]) { values = args; return result },
      async all() { return { results: stmt.all(...values) } } }; return result
  } } as unknown as D1Database
  const principal: RealtimeReadPrincipal = { actorId: 'actor-1', roles: [
    { role: 'VIEWER', scopeType: 'ACCOUNT', scopeKey: 'account-a', expiresAt: null, revokedAt: null },
  ] }
  return { db, DB, principal, now }
}

test('durable replay emits only authorized account events and preserves historical states', async () => {
  const f = fixture()
  const events = await readAuthorizedOrderEvents(f.DB, f.principal, 0, f.now)
  assert.equal(events.length, 11)
  assert.ok(events.every((event) => event.account_id === 'account-a'))
  assert.deepEqual(events.map((event) => event.state), ['SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED',
    'CANCEL_REQUESTED', 'CANCEL_PENDING', 'CANCELLED', 'REJECTED', 'RECOVERY_REQUIRED', 'FAILED', 'RISK_REJECTED'])
  assert.ok(events.every((event) => !('fill_price' in event)))
  assert.equal((await readAuthorizedOrderEvents(f.DB, f.principal, events[4]!.sequence_id, f.now)).length, 6)
  assert.deepEqual(await readAuthorizedOrderEvents(f.DB, f.principal, events.at(-1)!.sequence_id, f.now), [])
  f.db.close()
})

test('revoked, expired, malformed, missing and wrong-account grants never disclose events', async () => {
  const f = fixture()
  for (const change of [{ revokedAt: f.now }, { expiresAt: f.now }, { expiresAt: 'malformed' }, { scopeKey: 'other' }]) {
    assert.deepEqual(await readAuthorizedOrderEvents(f.DB, { ...f.principal,
      roles: [{ ...f.principal.roles[0]!, ...change }] }, 0, f.now), [])
  }
  assert.deepEqual(await readAuthorizedOrderEvents(f.DB, { ...f.principal, roles: [] }, 0, f.now), [])
  f.db.close()
})

test('global/exchange grants use the existing READ_ACCOUNT policy without granting any mutation', async () => {
  const f = fixture()
  for (const scopeType of ['GLOBAL', 'EXCHANGE'] as const) {
    const principal = { ...f.principal, roles: [{ ...f.principal.roles[0]!, scopeType,
      scopeKey: scopeType === 'GLOBAL' ? 'global' : 'BITGET' }] }
    assert.equal((await readAuthorizedOrderEvents(f.DB, principal, 0, f.now)).length, 22)
  }
  f.db.close()
})

test('invalid replay cursors fail closed', async () => {
  const f = fixture()
  for (const cursor of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(readAuthorizedOrderEvents(f.DB, f.principal, cursor, f.now), /cursor/)
  }
  f.db.close()
})
