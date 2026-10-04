import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { canonicalHash } from '../src/live/canonical-json.ts'
import { discoverScheduledRecovery } from '../src/live/scheduled-recovery-discovery.ts'
import { consumeScheduledRecoveryReads } from '../src/live/scheduled-recovery-read.ts'
import { claimQueueDelivery, completeQueueDelivery, failQueueDelivery } from '../src/live/queue-contracts.ts'

async function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of ['007_live_exchange_projections.sql', '009_live_queue_delivery.sql',
    '017_live_recovery_ingestion.sql', '021_live_bitget_read_only_certification.sql',
    '022_live_bitget_read_only_certification_attestation.sql', '023_live_bitget_attested_recovery_ingestion.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'))
  }
  const now = Date.parse('2026-10-04T00:00:00.000Z')
  const createdAt = new Date(now - 600_000).toISOString()
  const updatedAt = new Date(now - 360_000).toISOString()
  const DB = {
    prepare(sql: string) {
      const statement = db.prepare(sql)
      let values: (string | number | null)[] = []
      const wrapped = {
        bind(...args: (string | number | null)[]) { values = args; return wrapped },
        async first() { return statement.get(...values) ?? null },
        async all() { return { results: statement.all(...values) } },
        async run() { return { meta: { changes: Number(statement.run(...values).changes) } } },
      }
      return wrapped
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      db.exec('BEGIN')
      try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec('COMMIT'); return result }
      catch (error) { db.exec('ROLLBACK'); throw error }
    },
  } as unknown as D1Database
  db.prepare(`INSERT INTO live_exchange_accounts (exchange_account_id, exchange_name, external_account_ref_hash, status)
    VALUES ('account-1', 'BITGET', ?, 'READ_ONLY')`).run(await canonicalHash('provider-account'))
  db.prepare(`INSERT INTO live_orders (internal_order_id, exchange_account_id, exchange_order_id, client_order_id,
    product_id, side, order_type, state, requested_base_quantity, configuration_version, created_at, updated_at)
    VALUES ('order-1', 'account-1', 'exchange-1', 'client-1', 'BTC-USDT', 'BUY', 'LIMIT',
      'RECOVERY_REQUIRED', '0.01', 'v1', ?, ?)`).run(createdAt, updatedAt)
  db.prepare(`INSERT INTO live_bitget_read_only_certification_runs (run_id, provider, exchange_account_id, product_id,
    status, read_only_evidence_complete, permissions_verified, product_count, balance_count, current_order_count,
    history_order_count, fill_count, duplicate_order_count, duplicate_fill_count, evaluated_at, evidence_hash)
    VALUES ('run-1', 'BITGET', 'account-1', 'BTC-USDT', 'PASSED', 1, 1, 1, 2, 1, 0, 1, 0, 0, ?, ?)`)
    .run(updatedAt, 'a'.repeat(64))
  for (const name of ['READ_ONLY_PERMISSIONS', 'PRODUCT_CONTRACT', 'BALANCE_CONTRACT', 'CURRENT_ORDER_CONTRACT',
    'ORDER_HISTORY_CONTRACT', 'FILL_CONTRACT', 'PAGINATION_BOUNDARY', 'RECOVERY_IDENTITY_CONSISTENCY']) {
    db.prepare(`INSERT INTO live_bitget_read_only_certification_checks (run_id, check_name, status, evidence_hash)
      VALUES ('run-1', ?, 'PASS', ?)`).run(name, await canonicalHash(name))
  }
  const attestationHash = await canonicalHash({ attestationId: 'attestation-1', runId: 'run-1', runEvidenceHash: 'a'.repeat(64),
    sourceMode: 'ISOLATED_READ_ONLY_CLIENT', environment: 'SHADOW', sourceRef: 'test:simulated-external-client',
    operatorActorId: 'actor-1', authorizationEventHash: 'b'.repeat(64), attestedAt: updatedAt,
    externalReadOnlyEvidence: true, certificationCheckProjectionAllowed: false, certifiedForLive: false,
    providerMutationAllowed: false, automaticRetryAllowed: false, transferAllowed: false, withdrawalAllowed: false,
    executionAllowed: false, credentialsPersisted: false })
  db.prepare(`INSERT INTO live_bitget_read_only_certification_attestations (attestation_id, run_id, run_evidence_hash,
    source_mode, environment, source_ref, operator_actor_id, authorization_event_hash, attested_at, attestation_hash,
    external_read_only_evidence) VALUES ('attestation-1', 'run-1', ?, 'ISOLATED_READ_ONLY_CLIENT', 'SHADOW',
      'test:simulated-external-client', 'actor-1', ?, ?, ?, 1)`)
    .run('a'.repeat(64), 'b'.repeat(64), updatedAt, attestationHash)
  const env = { DB, LIVE_RECOVERY_DISCOVERY_ENABLED: 'true', LIVE_RECOVERY_ACCOUNT_IDS: '["account-1"]',
    LIVE_RECOVERY_READ_ENABLED: 'true', LIVE_RECOVERY_READ_ACCOUNT_ID: 'account-1',
    LIVE_RECOVERY_READ_ATTESTATIONS: '{"BTC-USDT":"attestation-1"}',
    BITGET_CERT_API_KEY: { get: async () => 'fixture-key' }, BITGET_CERT_API_SECRET: { get: async () => 'fixture-secret' },
    BITGET_CERT_API_PASSPHRASE: { get: async () => 'fixture-passphrase' } }
  await discoverScheduledRecovery(env, now)
  const calls: { path: string; method: string }[] = []
  const rawOrder = { orderId: 'exchange-1', clientOid: 'client-1', symbol: 'BTCUSDT', side: 'buy', orderType: 'limit',
    size: '0.01', baseVolume: '0.005', quoteVolume: '250', priceAvg: '50000', status: 'partially_filled',
    cTime: String(now - 600_000), uTime: String(now - 60_000), feeDetail: JSON.stringify({ totalFee: '-0.25', feeCoin: 'USDT' }) }
  const rawFill = { tradeId: 'fill-1', orderId: 'exchange-1', symbol: 'BTCUSDT', side: 'buy', size: '0.005',
    priceAvg: '50000', cTime: String(now - 60_000), uTime: String(now - 60_000),
    feeDetail: JSON.stringify({ totalFee: '-0.25', feeCoin: 'USDT' }) }
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push({ path, method: String(init?.method) })
    const data = path.endsWith('/account/info') ? { userId: 'provider-account', authorities: ['readonly'] }
      : path.endsWith('/unfilled-orders') ? { orderList: [rawOrder] }
        : path.endsWith('/history-orders') ? { orderList: [] } : { fillList: [rawFill] }
    return Response.json({ code: '00000', requestTime: now, data })
  }
  const queue = () => db.prepare('SELECT * FROM live_queue_messages').get()!
  const count = (table: string) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n)
  return { db, env, now, fetcher, calls, rawOrder, queue, count }
}

test('scheduled recovery performs only GETs and persists real attested evidence plus pending accounting, without financial projection', async () => {
  const f = await fixture()
  const before = f.db.prepare('SELECT * FROM live_orders').get()
  assert.deepEqual(await consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher }), { status: 'CONSUMED', completed: 1, failed: 0 })
  assert.equal(f.calls.length, 4)
  assert.ok(f.calls.every((call) => call.method === 'GET'))
  assert.equal(f.queue().status, 'COMPLETED')
  assert.equal(f.count('live_bitget_attested_recovery_ingestions'), 1)
  assert.equal(f.count('live_recovery_fill_observations'), 1)
  assert.equal(f.count('live_recovery_accounting_task_intents'), 1)
  const decision = f.db.prepare("SELECT payload_json FROM live_queue_messages WHERE message_type = 'NOTIFY_ALERT'").get()!
  assert.equal(JSON.parse(String(decision.payload_json)).decision.state, 'PARTIALLY_FILLED')
  assert.equal(f.count('live_fills'), 0)
  assert.deepEqual(f.db.prepare('SELECT * FROM live_orders').get(), before)
  const evidence = JSON.stringify(f.db.prepare('SELECT * FROM live_recovery_ingestions').all())
  for (const secret of ['fixture-key', 'fixture-secret', 'fixture-passphrase']) assert.ok(!evidence.includes(secret))
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now + 300_000, { fetcher: f.fetcher })).completed, 0)
  assert.equal(f.calls.length, 4)
  f.db.close()
})

test('concurrent consumers claim once before provider reads', async () => {
  const f = await fixture()
  const results = await Promise.all([consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher }),
    consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher })])
  assert.equal(results.reduce((n, r) => n + r.completed, 0), 1)
  assert.equal(f.calls.length, 4)
  f.db.close()
})

test('restart reclaims GET-only lease and expired worker cannot complete or fail successor work', async () => {
  const f = await fixture()
  const eventId = String(f.queue().event_id)
  const oldLease = new Date(f.now - 180_000).toISOString()
  assert.equal(await claimQueueDelivery(f.env, eventId, oldLease), true)
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher })).completed, 1)
  assert.equal(await completeQueueDelivery(f.env, eventId, oldLease, oldLease), false)
  assert.equal(await failQueueDelivery(f.env, { eventId, errorCode: 'OLD_WORKER', retryAt: oldLease, expectedStartedAt: oldLease }), false)
  assert.equal(f.queue().status, 'COMPLETED')
  f.db.close()
})

test('crash after attested persistence replays the same snapshot without duplicate evidence or accounting intent', async () => {
  const f = await fixture()
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher })).completed, 1)
  f.db.prepare(`UPDATE live_queue_messages SET status = 'PROCESSING', completed_at = NULL,
    processing_started_at = ?`).run(new Date(f.now - 180_000).toISOString())
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher })).completed, 1)
  assert.equal(f.count('live_recovery_ingestions'), 1)
  assert.equal(f.count('live_bitget_attested_recovery_ingestion_events'), 1)
  assert.equal(f.count('live_recovery_accounting_task_intents'), 1)
  f.db.close()
})

for (const scenario of ['wrong-provider', 'wrong-user', 'wrong-client', 'wrong-side', 'wrong-quantity', 'changed-order',
  'missing-identity', 'missing-key', 'missing-attestation', 'bad-attestation-hash', 'failed-certification', 'expired-attestation',
  'tampered-work', 'malformed-provider', 'provider-429', 'provider-5xx'] as const) {
  test(`${scenario} blocks attested ingestion without any financial mutation or credential leakage`, async () => {
    const f = await fixture()
    if (scenario === 'wrong-provider') f.db.exec("UPDATE live_exchange_accounts SET exchange_name = 'BTCC'")
    if (scenario === 'wrong-user') f.db.exec(`UPDATE live_exchange_accounts SET external_account_ref_hash = '${'f'.repeat(64)}'`)
    if (scenario === 'wrong-client') f.rawOrder.clientOid = 'other-client'
    if (scenario === 'wrong-side') f.rawOrder.side = 'sell'
    if (scenario === 'wrong-quantity') f.rawOrder.size = '0.02'
    if (scenario === 'changed-order') f.db.exec("UPDATE live_orders SET exchange_order_id = 'other-id'")
    if (scenario === 'missing-identity') f.db.exec('UPDATE live_orders SET exchange_order_id = NULL, client_order_id = NULL')
    if (scenario === 'missing-key') f.env.BITGET_CERT_API_KEY.get = async () => { throw new Error('fixture-secret') }
    if (scenario === 'missing-attestation') f.env.LIVE_RECOVERY_READ_ATTESTATIONS = '{"BTC-USDT":"absent-attestation"}'
    // Test corrupt/expired storage by explicitly dropping its immutability trigger in the test fixture only.
    if (['bad-attestation-hash', 'expired-attestation'].includes(scenario)) {
      f.db.exec('DROP TRIGGER live_bitget_read_only_certification_attestations_no_update')
      f.db.exec(scenario === 'bad-attestation-hash' ? `UPDATE live_bitget_read_only_certification_attestations SET attestation_hash = '${'e'.repeat(64)}'`
        : "UPDATE live_bitget_read_only_certification_attestations SET attested_at = '2026-10-01T00:00:00.000Z'")
    }
    if (scenario === 'failed-certification') {
      f.db.exec('DROP TRIGGER live_bitget_read_only_certification_checks_no_update')
      f.db.exec("UPDATE live_bitget_read_only_certification_checks SET status = 'FAIL' WHERE check_name = 'FILL_CONTRACT'")
    }
    if (scenario === 'tampered-work') f.db.exec(`UPDATE live_queue_messages SET payload_json = json_set(payload_json, '$.plan.instruction.lookupValue', 'other-id')`)
    const fetcher: typeof fetch = scenario === 'malformed-provider' ? async () => new Response('not json')
      : scenario === 'provider-429' ? async () => new Response('fixture-secret', { status: 429 })
        : scenario === 'provider-5xx' ? async () => new Response('fixture-secret', { status: 503 }) : f.fetcher
    if (scenario === 'wrong-provider') await assert.rejects(consumeScheduledRecoveryReads(f.env, f.now, { fetcher }), /identity is unavailable/)
    else assert.equal((await consumeScheduledRecoveryReads(f.env, f.now, { fetcher })).failed, 1)
    assert.equal(f.count('live_recovery_ingestions'), 0)
    assert.equal(f.count('live_fills'), 0)
    assert.ok(!JSON.stringify(f.queue()).includes('fixture-secret'))
    assert.ok(f.calls.every((call) => call.method === 'GET'))
    f.db.close()
  })
}

test('disabled consumer uses neither storage nor credentials', async () => {
  assert.equal((await consumeScheduledRecoveryReads({ DB: {} as D1Database }, 0)).status, 'DISABLED')
})

test('lease fencing rejects expired writes while a successor is still PROCESSING', async () => {
  const f = await fixture()
  const eventId = String(f.queue().event_id)
  const current = new Date(f.now).toISOString()
  const expired = new Date(f.now - 180_000).toISOString()
  assert.equal(await claimQueueDelivery(f.env, eventId, current), true)
  assert.equal(await completeQueueDelivery(f.env, eventId, current, expired), false)
  assert.equal(await failQueueDelivery(f.env, { eventId, errorCode: 'STALE', retryAt: current, expectedStartedAt: expired }), false)
  assert.equal(f.queue().status, 'PROCESSING')
  assert.equal(await completeQueueDelivery(f.env, eventId, current, current), true)
  f.db.close()
})

test('D1 persistence failure keeps recovery unresolved and does not write fills or leak provider text', async () => {
  const f = await fixture()
  f.env.DB.batch = async () => { throw new Error('fixture-secret') }
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher })).failed, 1)
  assert.equal(f.queue().status, 'FAILED')
  assert.equal(f.count('live_recovery_ingestions'), 0)
  assert.equal(f.count('live_fills'), 0)
  assert.ok(!JSON.stringify(f.queue()).includes('fixture-secret'))
  f.db.close()
})

test('bounded read failures stop after three attempts and never create an inferred financial retry', async () => {
  const f = await fixture()
  let calls = 0
  const fetcher: typeof fetch = async () => { calls += 1; return new Response('failure', { status: 503 }) }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await consumeScheduledRecoveryReads(f.env, f.now + attempt * 60_000, { fetcher })).failed, 1)
  }
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now + 300_000, { fetcher })).failed, 0)
  assert.equal(calls, 3)
  assert.equal(f.queue().attempt_count, 3)
  assert.equal(await claimQueueDelivery(f.env, String(f.queue().event_id), new Date(f.now + 600_000).toISOString(), 3), false)
  assert.equal(f.count('live_fills'), 0)
  f.db.close()
})

test('restart never reclaims another queue message type, even if its payload resembles discovery', async () => {
  const f = await fixture()
  f.db.prepare(`UPDATE live_queue_messages SET message_type = 'PROCESS_FILL', status = 'PROCESSING',
    processing_started_at = ?`).run(new Date(f.now - 180_000).toISOString())
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher })).completed, 0)
  assert.equal(f.calls.length, 0)
  assert.equal(f.queue().status, 'PROCESSING')
  f.db.close()
})

test('a hash-valid stale external attestation cannot authorize provider reads', async () => {
  const f = await fixture()
  const attestedAt = '2026-10-01T00:00:00.000Z'
  const hash = await canonicalHash({ attestationId: 'attestation-1', runId: 'run-1', runEvidenceHash: 'a'.repeat(64),
    sourceMode: 'ISOLATED_READ_ONLY_CLIENT', environment: 'SHADOW', sourceRef: 'test:simulated-external-client',
    operatorActorId: 'actor-1', authorizationEventHash: 'b'.repeat(64), attestedAt,
    externalReadOnlyEvidence: true, certificationCheckProjectionAllowed: false, certifiedForLive: false,
    providerMutationAllowed: false, automaticRetryAllowed: false, transferAllowed: false, withdrawalAllowed: false,
    executionAllowed: false, credentialsPersisted: false })
  f.db.exec('DROP TRIGGER live_bitget_read_only_certification_attestations_no_update')
  f.db.prepare('UPDATE live_bitget_read_only_certification_attestations SET attested_at = ?, attestation_hash = ?').run(attestedAt, hash)
  assert.equal((await consumeScheduledRecoveryReads(f.env, f.now, { fetcher: f.fetcher })).failed, 1)
  assert.equal(f.calls.length, 0)
  assert.equal(f.count('live_recovery_ingestions'), 0)
  f.db.close()
})
