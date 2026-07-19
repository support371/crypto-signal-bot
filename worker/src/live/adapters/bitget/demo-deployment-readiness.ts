import { canonicalHash, canonicalJson } from '../../canonical-json.ts'
import type { BitgetDemoDispatchEvidenceEnv } from './demo-dispatch-evidence-store.ts'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:._-]{1,128}$/
const HASH_PATTERN = /^[a-f0-9]{64}$/
const GIT_SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export const BITGET_DEMO_DEPLOYMENT_EVIDENCE_KEYS = Object.freeze([
  'candidateConfig',
  'isolatedD1',
  'isolatedR2',
  'isolatedKv',
  'rateLimitNamespace',
  'accountSerializer',
  'credentialLeaseAdapter',
  'getOnlyRecoveryAdapter',
  'demoFetchPolicy',
  'trustedClockPolicy',
  'securityReviewReference',
  'deploymentReviewReference',
] as const)

export type BitgetDemoDeploymentEvidenceKey =
  typeof BITGET_DEMO_DEPLOYMENT_EVIDENCE_KEYS[number]

export type BitgetDemoDeploymentEvidenceHashes = Readonly<
  Record<BitgetDemoDeploymentEvidenceKey, string | null>
>

interface PermanentReadinessLocks {
  deploymentAllowed: false
  demoRequestAllowed: false
  credentialsRead: false
  credentialsPersisted: false
  providerMutationAllowed: false
  executionAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
  accountingAutomaticallyDispatched: false
}

export interface BitgetDemoDeploymentReadinessInput {
  manifestId: string
  gitSha: string
  externalAttestationId: string | null
  evidenceHashes: BitgetDemoDeploymentEvidenceHashes
  preparedBy: string
  preparedAt: string
}

export interface BitgetDemoDeploymentReadinessCheck {
  name: string
  passed: boolean
  evidenceHash: string | null
  reason: string | null
}

export interface BitgetDemoDeploymentReadinessManifest
  extends PermanentReadinessLocks {
  manifestId: string
  gitSha: string
  environment: 'BITGET_DEMO_CERTIFICATION'
  externalAttestationId: string | null
  externalAttestationHash: string | null
  evidenceHashes: BitgetDemoDeploymentEvidenceHashes
  checks: readonly BitgetDemoDeploymentReadinessCheck[]
  checkCount: 14
  passedCount: number
  blockers: readonly string[]
  status: 'BLOCKED' | 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
  readyForNonLiveDeploymentReview: boolean
  manifestHash: string
  preparedBy: string
  preparedAt: string
  projectionStatus: 'PROJECTED' | 'REPLAYED'
}

type AttestationRow = Record<string, unknown> & {
  attestation_id: string
  attestation_hash: string
  source_mode: string
  environment: string
  operator_actor_id: string | null
  authorization_event_hash: string | null
  external_read_only_evidence: number
  certification_check_projection_allowed: number
  certified_for_live: number
  provider_mutation_allowed: number
  automatic_retry_allowed: number
  transfer_allowed: number
  withdrawal_allowed: number
  execution_allowed: number
  credentials_persisted: number
  run_status: string
  read_only_evidence_complete: number
  permissions_verified: number
  provider: string
  passed_check_count: number
  total_check_count: number
}

type ManifestRow = Record<string, unknown> & {
  manifest_id: string
  git_sha: string
  environment: string
  external_attestation_id: string | null
  external_attestation_hash: string | null
  evidence_hashes_json: string
  checks_json: string
  check_count: number
  passed_count: number
  blockers_json: string
  status: string
  ready_for_non_live_deployment_review: number
  manifest_hash: string
  prepared_by: string
  prepared_at: string
  deployment_allowed: number
  demo_request_allowed: number
  credentials_read: number
  credentials_persisted: number
  provider_mutation_allowed: number
  execution_allowed: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatic_retry_allowed: number
  accounting_automatically_dispatched: number
}

interface ManifestBase extends PermanentReadinessLocks {
  manifestId: string
  gitSha: string
  environment: 'BITGET_DEMO_CERTIFICATION'
  externalAttestationId: string | null
  externalAttestationHash: string | null
  evidenceHashes: BitgetDemoDeploymentEvidenceHashes
  checks: readonly BitgetDemoDeploymentReadinessCheck[]
  checkCount: 14
  passedCount: number
  blockers: readonly string[]
  status: 'BLOCKED' | 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
  readyForNonLiveDeploymentReview: boolean
  preparedBy: string
  preparedAt: string
}

export class BitgetDemoDeploymentReadinessConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BitgetDemoDeploymentReadinessConflictError'
  }
}

function identifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoDeploymentReadinessConflictError(`${field} is invalid`)
  }
  return normalized
}

function gitSha(value: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!GIT_SHA_PATTERN.test(normalized)) {
    throw new BitgetDemoDeploymentReadinessConflictError('gitSha must be an exact 40- or 64-character hexadecimal digest')
  }
  return normalized
}

function timestamp(value: string): string {
  const normalized = String(value ?? '').trim()
  const parsed = Date.parse(normalized)
  if (!normalized || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw new BitgetDemoDeploymentReadinessConflictError('preparedAt must be canonical ISO-8601')
  }
  return normalized
}

function normalizedEvidence(
  value: BitgetDemoDeploymentEvidenceHashes,
): BitgetDemoDeploymentEvidenceHashes {
  const output = {} as Record<BitgetDemoDeploymentEvidenceKey, string | null>
  for (const key of BITGET_DEMO_DEPLOYMENT_EVIDENCE_KEYS) {
    const candidate = value?.[key]
    const normalized = candidate === null || candidate === undefined
      ? null
      : String(candidate).trim().toLowerCase()
    if (normalized !== null && !HASH_PATTERN.test(normalized)) {
      throw new BitgetDemoDeploymentReadinessConflictError(`${key} evidence must be a SHA-256 digest or null`)
    }
    output[key] = normalized
  }
  return Object.freeze(output) as BitgetDemoDeploymentEvidenceHashes
}

async function loadExternalAttestation(
  env: BitgetDemoDispatchEvidenceEnv,
  attestationId: string | null,
): Promise<AttestationRow | null> {
  if (attestationId === null) return null
  return env.DB.prepare(`
    SELECT attestation.attestation_id, attestation.attestation_hash,
           attestation.source_mode, attestation.environment,
           attestation.operator_actor_id, attestation.authorization_event_hash,
           attestation.external_read_only_evidence,
           attestation.certification_check_projection_allowed,
           attestation.certified_for_live, attestation.provider_mutation_allowed,
           attestation.automatic_retry_allowed, attestation.transfer_allowed,
           attestation.withdrawal_allowed, attestation.execution_allowed,
           attestation.credentials_persisted,
           run.status AS run_status,
           run.read_only_evidence_complete,
           run.permissions_verified,
           run.provider,
           (SELECT COUNT(*)
              FROM live_bitget_read_only_certification_checks passed
             WHERE passed.run_id = run.run_id AND passed.status = 'PASS') AS passed_check_count,
           (SELECT COUNT(*)
              FROM live_bitget_read_only_certification_checks all_checks
             WHERE all_checks.run_id = run.run_id) AS total_check_count
      FROM live_bitget_read_only_certification_attestations attestation
      JOIN live_bitget_read_only_certification_runs run
        ON run.run_id = attestation.run_id
     WHERE attestation.attestation_id = ?
     LIMIT 1
  `).bind(attestationId).first<AttestationRow>()
}

function attestationCheck(row: AttestationRow | null): BitgetDemoDeploymentReadinessCheck {
  if (row === null) {
    return Object.freeze({
      name: 'EXTERNAL_READ_ONLY_ATTESTATION',
      passed: false,
      evidenceHash: null,
      reason: 'independently attested external Bitget read-only evidence is missing',
    })
  }
  const passed = (
    HASH_PATTERN.test(String(row.attestation_hash ?? ''))
    && row.source_mode === 'ISOLATED_READ_ONLY_CLIENT'
    && ['SHADOW', 'TESTNET', 'LIVE_CANDIDATE'].includes(row.environment)
    && Boolean(String(row.operator_actor_id ?? '').trim())
    && HASH_PATTERN.test(String(row.authorization_event_hash ?? ''))
    && row.external_read_only_evidence === 1
    && row.certification_check_projection_allowed === 0
    && row.certified_for_live === 0
    && row.provider_mutation_allowed === 0
    && row.automatic_retry_allowed === 0
    && row.transfer_allowed === 0
    && row.withdrawal_allowed === 0
    && row.execution_allowed === 0
    && row.credentials_persisted === 0
    && row.run_status === 'PASSED'
    && row.read_only_evidence_complete === 1
    && row.permissions_verified === 1
    && row.provider === 'BITGET'
    && row.passed_check_count === 8
    && row.total_check_count === 8
  )
  return Object.freeze({
    name: 'EXTERNAL_READ_ONLY_ATTESTATION',
    passed,
    evidenceHash: passed ? row.attestation_hash : null,
    reason: passed ? null : 'external Bitget read-only attestation is incomplete or conflicts with permanent locks',
  })
}

function evidenceChecks(
  evidence: BitgetDemoDeploymentEvidenceHashes,
): readonly BitgetDemoDeploymentReadinessCheck[] {
  return Object.freeze(BITGET_DEMO_DEPLOYMENT_EVIDENCE_KEYS.map((key) => {
    const evidenceHash = evidence[key]
    return Object.freeze({
      name: key.replace(/[A-Z]/g, (value) => `_${value}`).toUpperCase(),
      passed: evidenceHash !== null,
      evidenceHash,
      reason: evidenceHash === null ? `${key} evidence is missing` : null,
    })
  }))
}

function baseFromInput(input: {
  manifestId: string
  gitSha: string
  attestation: AttestationRow | null
  evidence: BitgetDemoDeploymentEvidenceHashes
  preparedBy: string
  preparedAt: string
}): ManifestBase {
  const checks = Object.freeze([
    Object.freeze({
      name: 'EXACT_GIT_SHA',
      passed: true,
      evidenceHash: null,
      reason: null,
    }),
    ...evidenceChecks(input.evidence),
    attestationCheck(input.attestation),
  ])
  const passedCount = checks.filter((check) => check.passed).length
  const blockers = Object.freeze(checks
    .filter((check) => !check.passed)
    .map((check) => check.reason ?? `${check.name} failed`))
  const ready = passedCount === 14
  return Object.freeze({
    manifestId: input.manifestId,
    gitSha: input.gitSha,
    environment: 'BITGET_DEMO_CERTIFICATION' as const,
    externalAttestationId: ready ? input.attestation?.attestation_id ?? null : null,
    externalAttestationHash: ready ? input.attestation?.attestation_hash ?? null : null,
    evidenceHashes: input.evidence,
    checks,
    checkCount: 14 as const,
    passedCount,
    blockers,
    status: ready ? 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW' as const : 'BLOCKED' as const,
    readyForNonLiveDeploymentReview: ready,
    preparedBy: input.preparedBy,
    preparedAt: input.preparedAt,
    deploymentAllowed: false as const,
    demoRequestAllowed: false as const,
    credentialsRead: false as const,
    credentialsPersisted: false as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
    accountingAutomaticallyDispatched: false as const,
  })
}

function rowBase(row: ManifestRow): ManifestBase {
  let evidence: unknown
  let checks: unknown
  let blockers: unknown
  try {
    evidence = JSON.parse(row.evidence_hashes_json) as unknown
    checks = JSON.parse(row.checks_json) as unknown
    blockers = JSON.parse(row.blockers_json) as unknown
  } catch {
    throw new BitgetDemoDeploymentReadinessConflictError('stored readiness JSON is malformed')
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)
    || !Array.isArray(checks) || !Array.isArray(blockers)) {
    throw new BitgetDemoDeploymentReadinessConflictError('stored readiness evidence is invalid')
  }
  return Object.freeze({
    manifestId: row.manifest_id,
    gitSha: row.git_sha,
    environment: 'BITGET_DEMO_CERTIFICATION' as const,
    externalAttestationId: row.external_attestation_id,
    externalAttestationHash: row.external_attestation_hash,
    evidenceHashes: Object.freeze(evidence) as BitgetDemoDeploymentEvidenceHashes,
    checks: Object.freeze(checks) as readonly BitgetDemoDeploymentReadinessCheck[],
    checkCount: 14 as const,
    passedCount: row.passed_count,
    blockers: Object.freeze(blockers.map(String)),
    status: row.status as ManifestBase['status'],
    readyForNonLiveDeploymentReview: row.ready_for_non_live_deployment_review === 1,
    preparedBy: row.prepared_by,
    preparedAt: row.prepared_at,
    deploymentAllowed: false,
    demoRequestAllowed: false,
    credentialsRead: false,
    credentialsPersisted: false,
    providerMutationAllowed: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
    accountingAutomaticallyDispatched: false,
  })
}

function assertRowLocks(row: ManifestRow): void {
  if (
    row.environment !== 'BITGET_DEMO_CERTIFICATION'
    || row.check_count !== 14
    || row.deployment_allowed !== 0
    || row.demo_request_allowed !== 0
    || row.credentials_read !== 0
    || row.credentials_persisted !== 0
    || row.provider_mutation_allowed !== 0
    || row.execution_allowed !== 0
    || row.live_execution_allowed !== 0
    || row.real_funds_allowed !== 0
    || row.mainnet_allowed !== 0
    || row.withdrawals_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.accounting_automatically_dispatched !== 0
  ) {
    throw new BitgetDemoDeploymentReadinessConflictError('stored readiness capability locks are invalid')
  }
}

async function loadManifest(
  env: BitgetDemoDispatchEvidenceEnv,
  manifestId: string,
  manifestHash: string,
): Promise<ManifestRow | null> {
  return env.DB.prepare(`
    SELECT manifest_id, git_sha, environment, external_attestation_id,
           external_attestation_hash, evidence_hashes_json, checks_json,
           check_count, passed_count, blockers_json, status,
           ready_for_non_live_deployment_review, manifest_hash, prepared_by,
           prepared_at, deployment_allowed, demo_request_allowed,
           credentials_read, credentials_persisted, provider_mutation_allowed,
           execution_allowed, live_execution_allowed, real_funds_allowed,
           mainnet_allowed, withdrawals_allowed, automatic_retry_allowed,
           accounting_automatically_dispatched
      FROM live_bitget_demo_deployment_readiness_manifests
     WHERE manifest_id = ? OR manifest_hash = ?
     LIMIT 1
  `).bind(manifestId, manifestHash).first<ManifestRow>()
}

function projection(
  status: 'PROJECTED' | 'REPLAYED',
  base: ManifestBase,
  manifestHash: string,
): BitgetDemoDeploymentReadinessManifest {
  return Object.freeze({ ...base, manifestHash, projectionStatus: status })
}

export async function evaluateAndRecordBitgetDemoDeploymentReadiness(
  env: BitgetDemoDispatchEvidenceEnv,
  input: BitgetDemoDeploymentReadinessInput,
): Promise<BitgetDemoDeploymentReadinessManifest> {
  const manifestId = identifier(input.manifestId, 'manifestId')
  const exactGitSha = gitSha(input.gitSha)
  const preparedBy = identifier(input.preparedBy, 'preparedBy')
  const preparedAt = timestamp(input.preparedAt)
  const attestationId = input.externalAttestationId === null
    ? null
    : identifier(input.externalAttestationId, 'externalAttestationId')
  const evidence = normalizedEvidence(input.evidenceHashes)
  const attestation = await loadExternalAttestation(env, attestationId)
  const base = baseFromInput({
    manifestId,
    gitSha: exactGitSha,
    attestation,
    evidence,
    preparedBy,
    preparedAt,
  })
  const manifestHash = await canonicalHash(base)
  const existing = await loadManifest(env, manifestId, manifestHash)
  if (existing) {
    assertRowLocks(existing)
    const storedBase = rowBase(existing)
    if (canonicalJson(storedBase) !== canonicalJson(base)
      || existing.manifest_hash !== manifestHash) {
      throw new BitgetDemoDeploymentReadinessConflictError('stored readiness manifest conflicts with current evidence')
    }
    return projection('REPLAYED', base, manifestHash)
  }

  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_deployment_readiness_manifests (
        manifest_id, git_sha, environment, external_attestation_id,
        external_attestation_hash, evidence_hashes_json, checks_json,
        check_count, passed_count, blockers_json, status,
        ready_for_non_live_deployment_review, manifest_hash, prepared_by,
        prepared_at, deployment_allowed, demo_request_allowed,
        credentials_read, credentials_persisted, provider_mutation_allowed,
        execution_allowed, live_execution_allowed, real_funds_allowed,
        mainnet_allowed, withdrawals_allowed, automatic_retry_allowed,
        accounting_automatically_dispatched
      ) VALUES (
        ?, ?, 'BITGET_DEMO_CERTIFICATION', ?, ?, ?, ?, 14, ?, ?, ?, ?, ?, ?, ?,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      )
    `).bind(
      base.manifestId,
      base.gitSha,
      base.externalAttestationId,
      base.externalAttestationHash,
      canonicalJson(base.evidenceHashes),
      canonicalJson(base.checks),
      base.passedCount,
      canonicalJson(base.blockers),
      base.status,
      base.readyForNonLiveDeploymentReview ? 1 : 0,
      manifestHash,
      base.preparedBy,
      base.preparedAt,
    ).run()
  } catch {
    throw new BitgetDemoDeploymentReadinessConflictError('immutable readiness manifest insert was rejected')
  }
  const stored = await loadManifest(env, manifestId, manifestHash)
  if (!stored) throw new Error('readiness manifest is missing after immutable insert')
  assertRowLocks(stored)
  if (canonicalJson(rowBase(stored)) !== canonicalJson(base)
    || stored.manifest_hash !== manifestHash) {
    throw new BitgetDemoDeploymentReadinessConflictError('stored readiness manifest failed post-insert verification')
  }
  return projection('PROJECTED', base, manifestHash)
}
