import { canonicalHash } from './canonical-json.ts'

export type BitgetReadOnlyCertificationSourceMode =
  | 'INJECTED_FIXTURES'
  | 'ISOLATED_READ_ONLY_CLIENT'

export type BitgetReadOnlyCertificationAttestationEnvironment =
  | 'LOCAL_TEST'
  | 'SHADOW'
  | 'TESTNET'
  | 'LIVE_CANDIDATE'

export interface BitgetReadOnlyCertificationAttestationEnv {
  DB: D1Database
}

export interface BitgetReadOnlyCertificationAttestationInput {
  attestationId: string
  runId: string
  sourceMode: BitgetReadOnlyCertificationSourceMode
  environment: BitgetReadOnlyCertificationAttestationEnvironment
  sourceRef: string
  operatorActorId: string | null
  authorizationEventHash: string | null
  attestedAt: string
}

export interface BitgetReadOnlyCertificationAttestationResult {
  persistenceStatus: 'PROJECTED' | 'REPLAYED'
  attestationId: string
  runId: string
  runEvidenceHash: string
  sourceMode: BitgetReadOnlyCertificationSourceMode
  environment: BitgetReadOnlyCertificationAttestationEnvironment
  externalReadOnlyEvidence: boolean
  attestationHash: string
  certificationCheckProjectionAllowed: false
  certifiedForLive: false
  providerMutationAllowed: false
  automaticRetryAllowed: false
  transferAllowed: false
  withdrawalAllowed: false
  executionAllowed: false
  credentialsPersisted: false
}

export class BitgetReadOnlyCertificationAttestationConflictError extends Error {
  readonly code = 'BITGET_READ_ONLY_CERTIFICATION_ATTESTATION_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'BitgetReadOnlyCertificationAttestationConflictError'
  }
}

type RunRow = {
  run_id: string
  provider: 'BITGET'
  status: 'PASSED' | 'FAILED' | 'BLOCKED'
  read_only_evidence_complete: number
  permissions_verified: number
  evidence_hash: string
  certified_for_live: number
  provider_mutation_allowed: number
  automatic_retry_allowed: number
  transfer_allowed: number
  withdrawal_allowed: number
  execution_allowed: number
  credentials_persisted: number
}

type CheckRow = {
  check_name: string
  status: 'PASS' | 'FAIL' | 'BLOCKED'
  evidence_hash: string
}

type AttestationRow = {
  attestation_id: string
  run_id: string
  run_evidence_hash: string
  source_mode: BitgetReadOnlyCertificationSourceMode
  environment: BitgetReadOnlyCertificationAttestationEnvironment
  source_ref: string
  operator_actor_id: string | null
  authorization_event_hash: string | null
  attested_at: string
  attestation_hash: string
  external_read_only_evidence: number
  certification_check_projection_allowed: number
  certified_for_live: number
  provider_mutation_allowed: number
  automatic_retry_allowed: number
  transfer_allowed: number
  withdrawal_allowed: number
  execution_allowed: number
  credentials_persisted: number
}

const REQUIRED_CHECK_COUNT = 8
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function sha256(value: string, field: string): string {
  const normalized = required(value, field).toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${field} must be a SHA-256 hash`)
  return normalized
}

function isoTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function assertRunLocks(row: RunRow): void {
  if (
    row.provider !== 'BITGET'
    || row.certified_for_live !== 0
    || row.provider_mutation_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.transfer_allowed !== 0
    || row.withdrawal_allowed !== 0
    || row.execution_allowed !== 0
    || row.credentials_persisted !== 0
  ) {
    throw new BitgetReadOnlyCertificationAttestationConflictError(
      'stored Bitget read-only certification run violates permanent capability locks',
    )
  }
  sha256(row.evidence_hash, 'runEvidenceHash')
}

function validateInput(
  input: BitgetReadOnlyCertificationAttestationInput,
): {
  attestationId: string
  runId: string
  sourceRef: string
  operatorActorId: string | null
  authorizationEventHash: string | null
  attestedAt: string
  externalReadOnlyEvidence: boolean
} {
  const attestationId = required(input.attestationId, 'attestationId')
  const runId = required(input.runId, 'runId')
  const sourceRef = required(input.sourceRef, 'sourceRef')
  const attestedAt = isoTimestamp(input.attestedAt, 'attestedAt')

  if (input.sourceMode === 'INJECTED_FIXTURES') {
    if (
      input.environment !== 'LOCAL_TEST'
      || input.operatorActorId !== null
      || input.authorizationEventHash !== null
    ) {
      throw new TypeError(
        'fixture certification evidence must remain LOCAL_TEST without operator authorization',
      )
    }
    return {
      attestationId,
      runId,
      sourceRef,
      operatorActorId: null,
      authorizationEventHash: null,
      attestedAt,
      externalReadOnlyEvidence: false,
    }
  }

  if (input.sourceMode !== 'ISOLATED_READ_ONLY_CLIENT') {
    throw new TypeError('unsupported Bitget read-only certification source mode')
  }
  if (input.environment === 'LOCAL_TEST') {
    throw new TypeError('isolated read-only client evidence cannot use LOCAL_TEST environment')
  }
  const operatorActorId = required(input.operatorActorId ?? '', 'operatorActorId')
  const authorizationEventHash = sha256(
    input.authorizationEventHash ?? '',
    'authorizationEventHash',
  )
  return {
    attestationId,
    runId,
    sourceRef,
    operatorActorId,
    authorizationEventHash,
    attestedAt,
    externalReadOnlyEvidence: true,
  }
}

async function loadRun(
  env: BitgetReadOnlyCertificationAttestationEnv,
  runId: string,
): Promise<RunRow> {
  const row = await env.DB.prepare(`
    SELECT run_id, provider, status, read_only_evidence_complete,
           permissions_verified, evidence_hash, certified_for_live,
           provider_mutation_allowed, automatic_retry_allowed,
           transfer_allowed, withdrawal_allowed, execution_allowed,
           credentials_persisted
      FROM live_bitget_read_only_certification_runs
     WHERE run_id = ?
     LIMIT 1
  `).bind(runId).first<RunRow>()
  if (!row) {
    throw new BitgetReadOnlyCertificationAttestationConflictError(
      'Bitget read-only certification run is missing',
    )
  }
  assertRunLocks(row)
  return row
}

async function loadChecks(
  env: BitgetReadOnlyCertificationAttestationEnv,
  runId: string,
): Promise<readonly CheckRow[]> {
  const result = await env.DB.prepare(`
    SELECT check_name, status, evidence_hash
      FROM live_bitget_read_only_certification_checks
     WHERE run_id = ?
     ORDER BY check_name ASC
  `).bind(runId).all<CheckRow>()
  const rows = Object.freeze([...(result.results ?? [])])
  for (const row of rows) sha256(row.evidence_hash, `checkEvidenceHash:${row.check_name}`)
  return rows
}

function assertExternalEvidenceEligible(row: RunRow, checks: readonly CheckRow[]): void {
  if (
    row.status !== 'PASSED'
    || row.read_only_evidence_complete !== 1
    || row.permissions_verified !== 1
    || checks.length !== REQUIRED_CHECK_COUNT
    || checks.some((check) => check.status !== 'PASS')
  ) {
    throw new BitgetReadOnlyCertificationAttestationConflictError(
      'isolated read-only evidence is incomplete, blocked, or failed',
    )
  }
}

async function loadAttestation(
  env: BitgetReadOnlyCertificationAttestationEnv,
  attestationId: string,
  runId: string,
  sourceMode: BitgetReadOnlyCertificationSourceMode,
): Promise<AttestationRow | null> {
  return env.DB.prepare(`
    SELECT attestation_id, run_id, run_evidence_hash, source_mode,
           environment, source_ref, operator_actor_id,
           authorization_event_hash, attested_at, attestation_hash,
           external_read_only_evidence, certification_check_projection_allowed,
           certified_for_live, provider_mutation_allowed,
           automatic_retry_allowed, transfer_allowed, withdrawal_allowed,
           execution_allowed, credentials_persisted
      FROM live_bitget_read_only_certification_attestations
     WHERE attestation_id = ? OR (run_id = ? AND source_mode = ?)
     LIMIT 1
  `).bind(attestationId, runId, sourceMode).first<AttestationRow>()
}

function assertAttestationLocks(row: AttestationRow): void {
  if (
    row.certification_check_projection_allowed !== 0
    || row.certified_for_live !== 0
    || row.provider_mutation_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.transfer_allowed !== 0
    || row.withdrawal_allowed !== 0
    || row.execution_allowed !== 0
    || row.credentials_persisted !== 0
  ) {
    throw new BitgetReadOnlyCertificationAttestationConflictError(
      'stored Bitget read-only certification attestation violates permanent capability locks',
    )
  }
}

function assertAttestationCompatible(
  row: AttestationRow,
  input: BitgetReadOnlyCertificationAttestationInput,
  normalized: ReturnType<typeof validateInput>,
  run: RunRow,
  attestationHash: string,
): void {
  assertAttestationLocks(row)
  if (
    row.attestation_id !== normalized.attestationId
    || row.run_id !== normalized.runId
    || row.run_evidence_hash !== run.evidence_hash
    || row.source_mode !== input.sourceMode
    || row.environment !== input.environment
    || row.source_ref !== normalized.sourceRef
    || row.operator_actor_id !== normalized.operatorActorId
    || row.authorization_event_hash !== normalized.authorizationEventHash
    || row.attested_at !== normalized.attestedAt
    || row.attestation_hash !== attestationHash
    || row.external_read_only_evidence !== (normalized.externalReadOnlyEvidence ? 1 : 0)
  ) {
    throw new BitgetReadOnlyCertificationAttestationConflictError(
      'stored Bitget read-only certification attestation conflicts with supplied evidence',
    )
  }
}

function result(
  persistenceStatus: BitgetReadOnlyCertificationAttestationResult['persistenceStatus'],
  input: BitgetReadOnlyCertificationAttestationInput,
  normalized: ReturnType<typeof validateInput>,
  run: RunRow,
  attestationHash: string,
): BitgetReadOnlyCertificationAttestationResult {
  return Object.freeze({
    persistenceStatus,
    attestationId: normalized.attestationId,
    runId: normalized.runId,
    runEvidenceHash: run.evidence_hash,
    sourceMode: input.sourceMode,
    environment: input.environment,
    externalReadOnlyEvidence: normalized.externalReadOnlyEvidence,
    attestationHash,
    certificationCheckProjectionAllowed: false,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  })
}

export async function attestBitgetReadOnlyCertificationSource(
  env: BitgetReadOnlyCertificationAttestationEnv,
  input: BitgetReadOnlyCertificationAttestationInput,
): Promise<BitgetReadOnlyCertificationAttestationResult> {
  const normalized = validateInput(input)
  const run = await loadRun(env, normalized.runId)
  const checks = await loadChecks(env, normalized.runId)
  if (input.sourceMode === 'ISOLATED_READ_ONLY_CLIENT') {
    assertExternalEvidenceEligible(run, checks)
  }

  const attestationHash = await canonicalHash({
    attestationId: normalized.attestationId,
    runId: normalized.runId,
    runEvidenceHash: run.evidence_hash,
    sourceMode: input.sourceMode,
    environment: input.environment,
    sourceRef: normalized.sourceRef,
    operatorActorId: normalized.operatorActorId,
    authorizationEventHash: normalized.authorizationEventHash,
    attestedAt: normalized.attestedAt,
    externalReadOnlyEvidence: normalized.externalReadOnlyEvidence,
    certificationCheckProjectionAllowed: false,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  })

  const existing = await loadAttestation(
    env,
    normalized.attestationId,
    normalized.runId,
    input.sourceMode,
  )
  if (existing) {
    assertAttestationCompatible(existing, input, normalized, run, attestationHash)
    return result('REPLAYED', input, normalized, run, attestationHash)
  }

  await env.DB.prepare(`
    INSERT INTO live_bitget_read_only_certification_attestations (
      attestation_id, run_id, run_evidence_hash, source_mode, environment,
      source_ref, operator_actor_id, authorization_event_hash, attested_at,
      attestation_hash, external_read_only_evidence,
      certification_check_projection_allowed, certified_for_live,
      provider_mutation_allowed, automatic_retry_allowed, transfer_allowed,
      withdrawal_allowed, execution_allowed, credentials_persisted
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
  `).bind(
    normalized.attestationId,
    normalized.runId,
    run.evidence_hash,
    input.sourceMode,
    input.environment,
    normalized.sourceRef,
    normalized.operatorActorId,
    normalized.authorizationEventHash,
    normalized.attestedAt,
    attestationHash,
    normalized.externalReadOnlyEvidence ? 1 : 0,
  ).run()

  const projected = await loadAttestation(
    env,
    normalized.attestationId,
    normalized.runId,
    input.sourceMode,
  )
  if (!projected) throw new Error('Bitget read-only certification attestation is missing after insert')
  assertAttestationCompatible(projected, input, normalized, run, attestationHash)
  return result('PROJECTED', input, normalized, run, attestationHash)
}
