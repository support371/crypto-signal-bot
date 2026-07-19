import assert from 'node:assert/strict'
import test from 'node:test'

import { routeOperatorReadRequest, type OperatorReadHttpEnv } from '../src/live/operator-read-http.ts'
import { sha256Hex } from '../src/live/operator-read-auth.ts'

const ORIGIN = 'https://operator.example'

class FakeD1 {
  row: Record<string, unknown>

  constructor() {
    this.row = {
      git_sha: 'a'.repeat(40),
      environment: 'BITGET_DEMO_CERTIFICATION',
      scenarios_json: JSON.stringify([
        { name: 'ROLLBACK_TO_KNOWN_GOOD', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:00:00.000Z', evidenceHash: 'hidden' },
        { name: 'DISASTER_RECOVERY_RESTORE', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:00:01.000Z', evidenceHash: 'hidden' },
        { name: 'ACCESS_REFERENCE_ROTATION', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:00:02.000Z', evidenceHash: 'hidden' },
        { name: 'PROVIDER_OUTAGE_FAIL_CLOSED', passed: false, evidencePresent: true, observedAt: '2026-07-19T18:00:03.000Z', evidenceHash: 'hidden' },
        { name: 'INCIDENT_ESCALATION_AND_CONTAINMENT', passed: true, evidencePresent: true, observedAt: '2026-07-19T18:00:04.000Z', evidenceHash: 'hidden' },
      ]),
      scenario_count: 5,
      passed_count: 4,
      blockers_json: JSON.stringify(['provider outage rehearsal remains blocked']),
      status: 'BLOCKED',
      ready_for_independent_review: 0,
      prepared_at: '2026-07-19T18:01:00.000Z',
      created_at: '2026-07-19 18:01:01',
      deployment_allowed: 0,
      demo_request_allowed: 0,
      credentials_read: 0,
      credentials_persisted: 0,
      provider_mutation_allowed: 0,
      execution_allowed: 0,
      live_execution_allowed: 0,
      real_funds_allowed: 0,
      mainnet_allowed: 0,
      withdrawals_allowed: 0,
      automatic_retry_allowed: 0,
      accounting_automatically_dispatched: 0,
      pack_id: 'hidden-pack-id',
      pack_hash: 'b'.repeat(64),
      prepared_by: 'hidden-preparer-id',
    }
  }

  prepare(sql: string): D1PreparedStatement {
    const database = this
    let values: unknown[] = []
    const statement = {
      bind(...next: unknown[]) {
        values = next
        return statement
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM live_bitget_demo_operational_rehearsal_packs')) {
          return database.row as T
        }
        return null
      },
      async all<T>(): Promise<{ results: T[] }> {
        if (sql.includes('FROM live_actor_roles') && String(values[0]) === 'auditor') {
          return { results: [{
            role: 'AUDITOR',
            scope_type: 'GLOBAL',
            scope_key: 'global',
            expires_at: null,
            revoked_at: null,
          }] as T[] }
        }
        return { results: [] }
      },
    }
    return statement as unknown as D1PreparedStatement
  }
}

async function env(): Promise<OperatorReadHttpEnv> {
  return {
    DB: new FakeD1() as unknown as D1Database,
    OPERATOR_API_KEY_HASHES: JSON.stringify({ auditor: await sha256Hex('auditor-secret') }),
    CORS_ALLOWED_ORIGINS: ORIGIN,
    TRADING_MODE: 'live-candidate',
    EXCHANGE_MODE: 'live-candidate',
    NETWORK: 'testnet',
    ALLOW_MAINNET: 'false',
    LIVE_EXECUTION_ENABLED: 'false',
    WITHDRAWALS_ENABLED: 'false',
    CANDIDATE_RESOURCES_CONFIGURED: 'false',
    BUILD_GIT_SHA: 'a'.repeat(40),
  }
}

function request(method = 'GET'): Request {
  return new Request('https://candidate.example/v1/operator/operational-readiness', {
    method,
    headers: {
      Origin: ORIGIN,
      'X-Operator-Id': 'auditor',
      'X-API-Key': 'auditor-secret',
    },
  })
}

test('global reviewer receives only sanitized operational evidence', async () => {
  const response = await routeOperatorReadRequest(request(), await env())
  assert.ok(response instanceof Response)
  assert.equal(response.status, 200)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.resource, 'OPERATIONAL_REHEARSAL')
  assert.equal(body.readOnly, true)
  assert.equal(body.deploymentAllowed, false)
  assert.equal(body.demoRequestAllowed, false)
  assert.equal(body.executionAllowed, false)
  assert.equal(body.automaticRetryAllowed, false)
  const evidence = body.evidence as Record<string, unknown>
  assert.deepEqual(evidence.checks, { total: 5, passed: 4, blocked: 1 })
  const serialized = JSON.stringify(body)
  for (const hidden of ['hidden-pack-id', 'hidden-preparer-id', 'evidenceHash', 'pack_hash']) {
    assert.ok(!serialized.includes(hidden), `response must hide ${hidden}`)
  }
})

test('HEAD suppresses the body and mutations remain disabled', async () => {
  const environment = await env()
  const head = await routeOperatorReadRequest(request('HEAD'), environment)
  assert.ok(head instanceof Response)
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  const post = await routeOperatorReadRequest(request('POST'), environment)
  assert.ok(post instanceof Response)
  assert.equal(post.status, 403)
  assert.equal((await post.json() as Record<string, unknown>).code, 'LIVE_CANDIDATE_READ_ONLY')
})

test('stored capability corruption is exposed only as blocked evidence', async () => {
  const environment = await env()
  const database = environment.DB as unknown as FakeD1
  database.row.deployment_allowed = 1
  const response = await routeOperatorReadRequest(request(), environment)
  assert.ok(response instanceof Response)
  const body = await response.json() as Record<string, unknown>
  const evidence = body.evidence as Record<string, unknown>
  assert.equal(evidence.status, 'BLOCKED')
  assert.equal(evidence.readyForIndependentReview, false)
  assert.ok((evidence.blockers as string[]).includes('stored_capability_lock_violation'))
  assert.equal(body.deploymentAllowed, false)
})
