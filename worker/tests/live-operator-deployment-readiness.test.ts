import assert from 'node:assert/strict'
import test from 'node:test'

import { roleMatchesReadScope } from '../src/live/operator-read-auth.ts'
import { readLatestBitgetDemoDeploymentReadiness } from '../src/live/operator-deployment-readiness-read-model.ts'
import type { ScopedRole } from '../src/live/authorization.ts'

const EVALUATED_AT = '2026-07-19T12:00:00.000Z'

function role(overrides: Partial<ScopedRole> = {}): ScopedRole {
  return {
    role: 'AUDITOR',
    scopeType: 'GLOBAL',
    scopeKey: 'global',
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  }
}

class FakeStatement {
  private readonly storedRow: Record<string, unknown> | null

  constructor(row: Record<string, unknown> | null) {
    this.storedRow = row
  }

  async first<T>(): Promise<T | null> {
    return this.storedRow as T | null
  }
}

function env(row: Record<string, unknown> | null) {
  return {
    DB: {
      prepare(sql: string) {
        assert.match(sql, /FROM live_bitget_demo_deployment_readiness_manifests/)
        assert.match(sql, /ORDER BY prepared_at DESC, created_at DESC/)
        return new FakeStatement(row)
      },
    } as unknown as D1Database,
  }
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    git_sha: 'a'.repeat(40),
    environment: 'BITGET_DEMO_CERTIFICATION',
    external_attestation_id: 'attestation-hidden-0001',
    check_count: 14,
    passed_count: 12,
    blockers_json: JSON.stringify(['isolatedD1 evidence is missing', 'deploymentReviewReference evidence is missing']),
    status: 'BLOCKED',
    ready_for_non_live_deployment_review: 0,
    prepared_at: '2026-07-19T11:59:00.000Z',
    created_at: '2026-07-19 11:59:01',
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
    manifest_id: 'manifest-hidden-0001',
    manifest_hash: 'b'.repeat(64),
    evidence_hashes_json: JSON.stringify({ isolatedD1: 'c'.repeat(64) }),
    ...overrides,
  }
}

test('deployment readiness requires an allowed global reviewer role', () => {
  const scope = {
    resource: 'DEPLOYMENT_READINESS' as const,
    exchangeName: null,
    exchangeAccountId: null,
  }
  assert.equal(roleMatchesReadScope(role(), scope, EVALUATED_AT), true)
  assert.equal(roleMatchesReadScope(role({ role: 'RELEASE_ADMIN' }), scope, EVALUATED_AT), true)
  assert.equal(roleMatchesReadScope(role({ role: 'RISK_ADMIN' }), scope, EVALUATED_AT), true)
  assert.equal(roleMatchesReadScope(role({ role: 'VIEWER' }), scope, EVALUATED_AT), false)
  assert.equal(roleMatchesReadScope(role({ scopeType: 'EXCHANGE', scopeKey: 'BITGET' }), scope, EVALUATED_AT), false)
  assert.equal(roleMatchesReadScope(role({ scopeType: 'ACCOUNT', scopeKey: 'account-1' }), scope, EVALUATED_AT), false)
})

test('latest readiness summary is sanitized and preserves permanent locks', async () => {
  const result = await readLatestBitgetDemoDeploymentReadiness(env(row()))
  assert.ok(result && typeof result === 'object')
  const evidence = result as Record<string, unknown>
  assert.equal(evidence.status, 'BLOCKED')
  assert.equal(evidence.readyForNonLiveDeploymentReview, false)
  assert.deepEqual(evidence.checks, { total: 14, passed: 12, blocked: 2 })
  assert.equal(evidence.externalReadOnlyAttestationPresent, true)
  assert.equal(evidence.gitSha, 'a'.repeat(40))
  assert.equal(evidence.deploymentAllowed, false)
  assert.equal(evidence.demoRequestAllowed, false)
  assert.equal(evidence.credentialsRead, false)
  assert.equal(evidence.providerMutationAllowed, false)
  assert.equal(evidence.executionAllowed, false)

  for (const forbidden of [
    'manifestId',
    'manifestHash',
    'externalAttestationId',
    'evidenceHashes',
    'preparedBy',
  ]) {
    assert.equal(Object.hasOwn(evidence, forbidden), false)
  }
})

test('missing readiness evidence returns null', async () => {
  assert.equal(await readLatestBitgetDemoDeploymentReadiness(env(null)), null)
})

test('stored capability corruption fails closed in the sanitized summary', async () => {
  const result = await readLatestBitgetDemoDeploymentReadiness(env(row({
    status: 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW',
    ready_for_non_live_deployment_review: 1,
    passed_count: 14,
    blockers_json: '[]',
    deployment_allowed: 1,
  })))
  assert.ok(result && typeof result === 'object')
  const evidence = result as Record<string, unknown>
  assert.equal(evidence.status, 'BLOCKED')
  assert.equal(evidence.readyForNonLiveDeploymentReview, false)
  assert.deepEqual(evidence.blockers, ['stored_capability_lock_violation'])
  assert.equal(evidence.deploymentAllowed, false)
})
