import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BITGET_DEMO_DEPLOYMENT_EVIDENCE_KEYS,
  BitgetDemoDeploymentReadinessConflictError,
  evaluateAndRecordBitgetDemoDeploymentReadiness,
  type BitgetDemoDeploymentEvidenceHashes,
} from '../src/live/adapters/bitget/demo-deployment-readiness.ts'

const GIT_SHA = 'a'.repeat(40)
const PREPARED_AT = '2026-07-19T12:00:00.000Z'

function completeEvidence(): BitgetDemoDeploymentEvidenceHashes {
  return Object.freeze(Object.fromEntries(
    BITGET_DEMO_DEPLOYMENT_EVIDENCE_KEYS.map((key, index) => [
      key,
      (index % 10).toString(16).repeat(64),
    ]),
  )) as BitgetDemoDeploymentEvidenceHashes
}

function validAttestation() {
  return {
    attestation_id: 'external-attestation-0001',
    attestation_hash: 'b'.repeat(64),
    source_mode: 'ISOLATED_READ_ONLY_CLIENT',
    environment: 'TESTNET',
    operator_actor_id: 'independent-operator-0001',
    authorization_event_hash: 'c'.repeat(64),
    external_read_only_evidence: 1,
    certification_check_projection_allowed: 0,
    certified_for_live: 0,
    provider_mutation_allowed: 0,
    automatic_retry_allowed: 0,
    transfer_allowed: 0,
    withdrawal_allowed: 0,
    execution_allowed: 0,
    credentials_persisted: 0,
    run_status: 'PASSED',
    read_only_evidence_complete: 1,
    permissions_verified: 1,
    provider: 'BITGET',
    passed_check_count: 8,
    total_check_count: 8,
  }
}

class FakeD1 {
  attestation: Record<string, unknown> | null
  manifests: Record<string, unknown>[] = []

  constructor(attestation: Record<string, unknown> | null) {
    this.attestation = attestation
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
        if (sql.includes('FROM live_bitget_read_only_certification_attestations')) {
          return database.attestation && database.attestation.attestation_id === String(values[0])
            ? database.attestation as T
            : null
        }
        if (sql.includes('FROM live_bitget_demo_deployment_readiness_manifests')) {
          const [manifestId, manifestHash] = values.map(String)
          return (database.manifests.find((row) => (
            row.manifest_id === manifestId || row.manifest_hash === manifestHash
          )) ?? null) as T | null
        }
        return null
      },
      async all<T>(): Promise<D1Result<T>> {
        return { results: [] } as D1Result<T>
      },
      async run(): Promise<D1Result> {
        if (sql.includes('INSERT INTO live_bitget_demo_deployment_readiness_manifests')) {
          if (database.manifests.some((row) => (
            row.manifest_id === String(values[0]) || row.manifest_hash === String(values[10])
          ))) {
            throw new Error('readiness uniqueness conflict')
          }
          database.manifests.push({
            manifest_id: String(values[0]),
            git_sha: String(values[1]),
            environment: 'BITGET_DEMO_CERTIFICATION',
            external_attestation_id: values[2] === null ? null : String(values[2]),
            external_attestation_hash: values[3] === null ? null : String(values[3]),
            evidence_hashes_json: String(values[4]),
            checks_json: String(values[5]),
            check_count: 14,
            passed_count: Number(values[6]),
            blockers_json: String(values[7]),
            status: String(values[8]),
            ready_for_non_live_deployment_review: Number(values[9]),
            manifest_hash: String(values[10]),
            prepared_by: String(values[11]),
            prepared_at: String(values[12]),
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
          })
        }
        return {} as D1Result
      },
    }
    return statement as unknown as D1PreparedStatement
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

function input(overrides: Partial<Parameters<typeof evaluateAndRecordBitgetDemoDeploymentReadiness>[1]> = {}) {
  return {
    manifestId: 'demo-deployment-readiness-0001',
    gitSha: GIT_SHA,
    externalAttestationId: 'external-attestation-0001',
    evidenceHashes: completeEvidence(),
    preparedBy: 'release-preparer-0001',
    preparedAt: PREPARED_AT,
    ...overrides,
  }
}

test('complete evidence becomes review-ready but never permits deployment or a demo request', async () => {
  const database = new FakeD1(validAttestation())
  const manifest = await evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input())
  assert.equal(manifest.projectionStatus, 'PROJECTED')
  assert.equal(manifest.status, 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW')
  assert.equal(manifest.passedCount, 14)
  assert.equal(manifest.readyForNonLiveDeploymentReview, true)
  assert.equal(manifest.deploymentAllowed, false)
  assert.equal(manifest.demoRequestAllowed, false)
  assert.equal(manifest.credentialsRead, false)
  assert.equal(manifest.liveExecutionAllowed, false)
  assert.equal(manifest.realFundsAllowed, false)
})

test('missing evidence creates an immutable blocked manifest', async () => {
  const database = new FakeD1(null)
  const evidence = completeEvidence() as Record<string, string | null>
  evidence.isolatedD1 = null
  evidence.credentialLeaseAdapter = null
  const manifest = await evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input({
    externalAttestationId: null,
    evidenceHashes: Object.freeze(evidence) as BitgetDemoDeploymentEvidenceHashes,
  }))
  assert.equal(manifest.status, 'BLOCKED')
  assert.equal(manifest.readyForNonLiveDeploymentReview, false)
  assert.equal(manifest.externalAttestationId, null)
  assert.ok(manifest.blockers.some((reason) => reason.includes('isolatedD1')))
  assert.ok(manifest.blockers.some((reason) => reason.includes('credentialLeaseAdapter')))
  assert.ok(manifest.blockers.some((reason) => reason.includes('attested external')))
  assert.equal(database.manifests[0]?.deployment_allowed, 0)
})

test('fixture or local-only attestation cannot satisfy external evidence', async () => {
  const local = validAttestation()
  local.source_mode = 'LOCAL_FIXTURE'
  local.environment = 'LOCAL_TEST'
  local.external_read_only_evidence = 0
  const database = new FakeD1(local)
  const manifest = await evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input())
  assert.equal(manifest.status, 'BLOCKED')
  assert.ok(manifest.blockers.some((reason) => reason.includes('attestation is incomplete')))
  assert.equal(manifest.demoRequestAllowed, false)
})

test('exact evidence replays and changed evidence conflicts', async () => {
  const database = new FakeD1(validAttestation())
  const first = await evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input())
  const replay = await evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input())
  assert.equal(replay.projectionStatus, 'REPLAYED')
  assert.equal(replay.manifestHash, first.manifestHash)
  assert.equal(database.manifests.length, 1)

  const changed = { ...completeEvidence(), trustedClockPolicy: 'f'.repeat(64) }
  await assert.rejects(
    evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input({
      evidenceHashes: Object.freeze(changed),
    })),
    BitgetDemoDeploymentReadinessConflictError,
  )
})

test('stored capability corruption is rejected on replay', async () => {
  const database = new FakeD1(validAttestation())
  await evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input())
  database.manifests[0]!.deployment_allowed = 1
  await assert.rejects(
    evaluateAndRecordBitgetDemoDeploymentReadiness(database.env(), input()),
    /capability locks are invalid/,
  )
})
