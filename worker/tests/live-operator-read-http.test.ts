import assert from 'node:assert/strict'
import test from 'node:test'

import {
  routeOperatorReadRequest,
  type OperatorReadHttpEnv,
} from '../src/live/operator-read-http.ts'
import { liveCandidatePreflight } from '../src/live/live-candidate-response.ts'
import { sha256Hex } from '../src/live/operator-read-auth.ts'

const ALLOWED_ORIGIN = 'https://operator.example'
const ACCOUNT_ID = 'account-1'

type RoleRow = {
  role: string
  scope_type: string
  scope_key: string
  expires_at: string | null
  revoked_at: string | null
}

class FakeStatement {
  private readonly database: FakeD1
  private readonly sql: string
  private values: unknown[] = []

  constructor(database: FakeD1, sql: string) {
    this.database = database
    this.sql = sql
  }

  bind(...values: unknown[]): FakeStatement {
    this.values = values
    return this
  }

  async first<T>(): Promise<T | null> {
    if (this.sql.includes('FROM live_bitget_demo_deployment_readiness_manifests')) {
      return this.database.deploymentReadiness as T
    }
    return null
  }

  async all<T>(): Promise<{ results: T[] }> {
    if (this.sql.includes('FROM live_actor_roles')) {
      const actorId = String(this.values[0] ?? '')
      return { results: (this.database.rolesByActor[actorId] ?? []) as T[] }
    }
    if (this.sql.includes('FROM live_alerts')) {
      return { results: [] }
    }
    if (this.sql.includes('FROM live_bitget_read_only_certification_checks')) {
      return { results: [] }
    }
    return { results: [] }
  }
}

class FakeD1 {
  readonly rolesByActor: Readonly<Record<string, readonly RoleRow[]>>
  readonly deploymentReadiness: Record<string, unknown>

  constructor() {
    this.rolesByActor = Object.freeze({
      auditor: Object.freeze([Object.freeze({
        role: 'AUDITOR',
        scope_type: 'GLOBAL',
        scope_key: 'global',
        expires_at: null,
        revoked_at: null,
      })]),
      viewer: Object.freeze([Object.freeze({
        role: 'VIEWER',
        scope_type: 'ACCOUNT',
        scope_key: ACCOUNT_ID,
        expires_at: null,
        revoked_at: null,
      })]),
      trader: Object.freeze([Object.freeze({
        role: 'TRADER',
        scope_type: 'GLOBAL',
        scope_key: 'global',
        expires_at: null,
        revoked_at: null,
      })]),
    })
    this.deploymentReadiness = Object.freeze({
      git_sha: 'a'.repeat(40),
      environment: 'BITGET_DEMO_CERTIFICATION',
      external_attestation_id: 'hidden-attestation-id',
      check_count: 14,
      passed_count: 12,
      blockers_json: JSON.stringify([
        'isolatedD1 evidence is missing',
        'deploymentReviewReference evidence is missing',
      ]),
      status: 'BLOCKED',
      ready_for_non_live_deployment_review: 0,
      prepared_at: '2026-07-19T12:00:00.000Z',
      created_at: '2026-07-19 12:00:01',
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
      manifest_id: 'hidden-manifest-id',
      manifest_hash: 'b'.repeat(64),
      evidence_hashes_json: JSON.stringify({ isolatedD1: 'c'.repeat(64) }),
      prepared_by: 'hidden-preparer-id',
    })
  }

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }
}

async function environment(configured = true): Promise<OperatorReadHttpEnv> {
  const hashes = configured ? {
    auditor: await sha256Hex('auditor-secret'),
    viewer: await sha256Hex('viewer-secret'),
    trader: await sha256Hex('trader-secret'),
  } : {}

  return {
    DB: new FakeD1() as unknown as D1Database,
    OPERATOR_API_KEY_HASHES: configured ? JSON.stringify(hashes) : undefined,
    CORS_ALLOWED_ORIGINS: `${ALLOWED_ORIGIN},https://second.example`,
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

function operatorRequest(
  path: string,
  actorId: string,
  secret: string,
  method = 'GET',
): Request {
  return new Request(`https://candidate.example${path}`, {
    method,
    headers: {
      Origin: ALLOWED_ORIGIN,
      'X-Operator-Id': actorId,
      'X-API-Key': secret,
    },
  })
}

function requireResponse(value: Response | null): Response {
  assert.ok(value instanceof Response)
  return value
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>
}

function assertReadOnlyHeaders(response: Response): void {
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(response.headers.get('X-Live-Candidate'), 'read-only')
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN)
  assert.equal(response.headers.get('Access-Control-Allow-Credentials'), null)
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff')
}

test('operator CORS preflight is exact-origin and read-method only', async () => {
  const env = await environment()
  const allowed = liveCandidatePreflight(new Request('https://candidate.example/v1/operator/certification', {
    method: 'OPTIONS',
    headers: { Origin: `${ALLOWED_ORIGIN}/` },
  }), env)
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), ALLOWED_ORIGIN)
  assert.equal(allowed.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD, OPTIONS')
  assert.doesNotMatch(allowed.headers.get('Access-Control-Allow-Methods') ?? '', /POST|PUT|PATCH|DELETE/)

  const rejected = liveCandidatePreflight(new Request('https://candidate.example/v1/operator/certification', {
    method: 'OPTIONS',
    headers: { Origin: 'https://untrusted.example' },
  }), env)
  assert.equal(rejected.status, 403)
  assert.equal((await jsonBody(rejected)).error, 'Origin not allowed')
})

test('operator router rejects mutations and fails authentication closed', async () => {
  const configuredEnv = await environment()
  const mutation = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/certification?account_id=account-1', 'auditor', 'auditor-secret', 'POST'),
    configuredEnv,
  ))
  assert.equal(mutation.status, 403)
  assert.equal((await jsonBody(mutation)).code, 'LIVE_CANDIDATE_READ_ONLY')

  const unconfigured = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/activation-gate', 'auditor', 'auditor-secret'),
    await environment(false),
  ))
  assert.equal(unconfigured.status, 503)
  assert.equal((await jsonBody(unconfigured)).code, 'OPERATOR_AUTH_NOT_CONFIGURED')

  const wrongSecret = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/activation-gate', 'auditor', 'wrong-secret'),
    configuredEnv,
  ))
  assert.equal(wrongSecret.status, 401)
  assert.equal((await jsonBody(wrongSecret)).code, 'OPERATOR_AUTHENTICATION_FAILED')
})

test('global and account role boundaries are enforced by the HTTP router', async () => {
  const env = await environment()
  const accountRead = requireResponse(await routeOperatorReadRequest(
    operatorRequest(`/v1/operator/certification?account_id=${ACCOUNT_ID}`, 'viewer', 'viewer-secret'),
    env,
  ))
  assert.equal(accountRead.status, 200)
  assert.equal((await jsonBody(accountRead)).resource, 'CERTIFICATION')

  const wrongAccount = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/certification?account_id=account-2', 'viewer', 'viewer-secret'),
    env,
  ))
  assert.equal(wrongAccount.status, 403)
  assert.equal((await jsonBody(wrongAccount)).code, 'OPERATOR_READ_FORBIDDEN')

  for (const path of [
    '/v1/operator/activation-gate',
    '/v1/operator/deployment-readiness',
    `/v1/operator/audit-head?account_id=${ACCOUNT_ID}`,
  ]) {
    const response = requireResponse(await routeOperatorReadRequest(
      operatorRequest(path, 'viewer', 'viewer-secret'),
      env,
    ))
    assert.equal(response.status, 403)
    assert.equal((await jsonBody(response)).code, 'OPERATOR_READ_FORBIDDEN')
  }

  const missingAccount = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/reconciliation', 'auditor', 'auditor-secret'),
    env,
  ))
  assert.equal(missingAccount.status, 400)
  assert.equal((await jsonBody(missingAccount)).code, 'OPERATOR_ACCOUNT_ID_REQUIRED')
})

test('all seven operator GET routes preserve permanent non-live locks', async () => {
  const env = await environment()

  const activation = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/activation-gate', 'auditor', 'auditor-secret'),
    env,
  ))
  assert.equal(activation.status, 503)
  assertReadOnlyHeaders(activation)
  const activationBody = await jsonBody(activation)
  assert.equal(activationBody.activationEnabled, false)
  assert.equal(activationBody.activationBlocked, true)
  assert.equal(activationBody.realMoneyMovementAllowed, false)
  assert.equal(activationBody.liveReady, false)

  const deployment = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/deployment-readiness', 'auditor', 'auditor-secret'),
    env,
  ))
  assert.equal(deployment.status, 200)
  assertReadOnlyHeaders(deployment)
  const deploymentBody = await jsonBody(deployment)
  assert.equal(deploymentBody.resource, 'DEPLOYMENT_READINESS')
  assert.equal(deploymentBody.deploymentAllowed, false)
  assert.equal(deploymentBody.demoRequestAllowed, false)
  assert.equal(deploymentBody.credentialsRead, false)
  const deploymentEvidence = deploymentBody.evidence as Record<string, unknown>
  assert.deepEqual(deploymentEvidence.checks, { total: 14, passed: 12, blocked: 2 })
  const serialized = JSON.stringify(deploymentBody)
  for (const hidden of [
    'hidden-attestation-id',
    'hidden-manifest-id',
    'hidden-preparer-id',
    'evidence_hashes_json',
  ]) {
    assert.ok(!serialized.includes(hidden), `deployment response must hide ${hidden}`)
  }

  const accountRoutes = [
    ['/v1/operator/certification', 'CERTIFICATION'],
    ['/v1/operator/recovery-readiness', 'RECOVERY_READINESS'],
    ['/v1/operator/reconciliation', 'RECONCILIATION'],
    ['/v1/operator/alerts?limit=1000', 'ALERTS'],
    ['/v1/operator/audit-head', 'AUDIT_HEAD'],
  ] as const

  for (const [basePath, resource] of accountRoutes) {
    const separator = basePath.includes('?') ? '&' : '?'
    const response = requireResponse(await routeOperatorReadRequest(
      operatorRequest(`${basePath}${separator}account_id=${ACCOUNT_ID}&product_id=btcusdt`, 'auditor', 'auditor-secret'),
      env,
    ))
    assert.equal(response.status, 200, resource)
    assertReadOnlyHeaders(response)
    const body = await jsonBody(response)
    assert.equal(body.resource, resource)
    assert.equal(body.readOnly, true)
    assert.equal(body.providerMutationAllowed, false)
    assert.equal(body.executionAllowed, false)
    assert.equal(body.withdrawalsAllowed, false)
    if (resource === 'ALERTS') assert.deepEqual(body.evidence, [])
    else assert.equal(body.evidence, null)
  }
})

test('HEAD suppresses bodies and unknown/non-operator paths are explicit', async () => {
  const env = await environment()
  const head = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/deployment-readiness', 'auditor', 'auditor-secret', 'HEAD'),
    env,
  ))
  assert.equal(head.status, 200)
  assertReadOnlyHeaders(head)
  assert.equal(await head.text(), '')

  const unknown = requireResponse(await routeOperatorReadRequest(
    operatorRequest('/v1/operator/not-a-route', 'auditor', 'auditor-secret'),
    env,
  ))
  assert.equal(unknown.status, 404)
  assert.equal((await jsonBody(unknown)).code, 'OPERATOR_ROUTE_NOT_FOUND')

  assert.equal(await routeOperatorReadRequest(
    new Request('https://candidate.example/v1/live/capabilities'),
    env,
  ), null)
})
