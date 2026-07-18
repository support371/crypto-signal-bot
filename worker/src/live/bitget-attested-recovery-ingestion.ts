import { canonicalHash } from './canonical-json.ts'
import type {
  BitgetReadOnlyCertificationAttestationEnvironment,
  BitgetReadOnlyCertificationSourceMode,
} from './bitget-read-only-certification-attestation.ts'
import type { BitgetRecoveryIngestionPlan } from './recovery-ingestion.ts'
import {
  persistBitgetRecoveryIngestion,
  type PersistRecoveryIngestionResult,
  type RecoveryIngestionStoreEnv,
} from './recovery-ingestion-store.ts'

export interface BitgetAttestedRecoveryIngestionEnv extends RecoveryIngestionStoreEnv {}

export interface BitgetAttestedRecoveryIngestionInput {
  bindingId: string
  attestationId: string
  linkedAt: string
  plan: BitgetRecoveryIngestionPlan
}

export interface BitgetAttestedRecoveryIngestionResult {
  persistenceStatus: 'BOUND' | 'REPLAYED'
  ingestionPersistenceStatus: PersistRecoveryIngestionResult['status']
  bindingId: string
  bindingHash: string
  attestationId: string
  certificationRunId: string
  runEvidenceHash: string
  attestationHash: string
  sourceMode: BitgetReadOnlyCertificationSourceMode
  certificationEnvironment: BitgetReadOnlyCertificationAttestationEnvironment
  externalReadOnlyEvidence: boolean
  ingestionId: string
  ingestionHash: string
  snapshotId: string
  snapshotHash: string
  exchangeAccountId: string
  productId: string
  accountingTaskCount: number
  automaticAccountingDispatchAllowed: false
  reservationSettlementAllowed: false
  certificationCheckProjectionAllowed: false
  certifiedForLive: false
  providerMutationAllowed: false
  automaticRetryAllowed: false
  transferAllowed: false
  withdrawalAllowed: false
  executionAllowed: false
  credentialsPersisted: false
  reconciliationRequired: true
  incidentEvidenceRequired: true
}

export interface BitgetAttestedRecoveryIngestionDependencies {
  persistIngestion?: (
    env: RecoveryIngestionStoreEnv,
    plan: BitgetRecoveryIngestionPlan,
  ) => Promise<PersistRecoveryIngestionResult>
}

export class BitgetAttestedRecoveryIngestionConflictError extends Error {
  readonly code = 'BITGET_ATTESTED_RECOVERY_INGESTION_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'BitgetAttestedRecoveryIngestionConflictError'
  }
}

type AttestationPackageRow = {
  attestation_id: string
  certification_run_id: string
  run_evidence_hash: string
  run_exchange_account_id: string
  run_product_id: string
  run_status: 'PASSED' | 'FAILED' | 'BLOCKED'
  run_read_only_evidence_complete: number
  run_permissions_verified: number
  source_mode: BitgetReadOnlyCertificationSourceMode
  certification_environment: BitgetReadOnlyCertificationAttestationEnvironment
  source_ref: string
  operator_actor_id: string | null
  authorization_event_hash: string | null
  attested_at: string
  attestation_hash: string
  external_read_only_evidence: number
  run_certified_for_live: number
  run_provider_mutation_allowed: number
  run_automatic_retry_allowed: number
  run_transfer_allowed: number
  run_withdrawal_allowed: number
  run_execution_allowed: number
  run_credentials_persisted: number
  attestation_certification_check_projection_allowed: number
  attestation_certified_for_live: number
  attestation_provider_mutation_allowed: number
  attestation_automatic_retry_allowed: number
  attestation_transfer_allowed: number
  attestation_withdrawal_allowed: number
  attestation_execution_allowed: number
  attestation_credentials_persisted: number
}

type CertificationCheckRow = {
  check_name: string
  status: 'PASS' | 'FAIL' | 'BLOCKED'
  evidence_hash: string
}

type BindingRow = {
  binding_id: string
  attestation_id: string
  certification_run_id: string
  run_evidence_hash: string
  attestation_hash: string
  source_mode: BitgetReadOnlyCertificationSourceMode
  certification_environment: BitgetReadOnlyCertificationAttestationEnvironment
  external_read_only_evidence: number
  ingestion_id: string
  snapshot_id: string
  snapshot_hash: string
  ingestion_hash: string
  exchange_account_id: string
  product_id: string
  accounting_task_count: number
  linked_at: string
  binding_hash: string
  automatic_accounting_dispatch_allowed: number
  reservation_settlement_allowed: number
  certification_check_projection_allowed: number
  certified_for_live: number
  provider_mutation_allowed: number
  automatic_retry_allowed: number
  transfer_allowed: number
  withdrawal_allowed: number
  execution_allowed: number
  credentials_persisted: number
  reconciliation_required: number
  incident_evidence_required: number
}

const REQUIRED_CHECKS = Object.freeze([
  'READ_ONLY_PERMISSIONS',
  'PRODUCT_CONTRACT',
  'BALANCE_CONTRACT',
  'CURRENT_ORDER_CONTRACT',
  'ORDER_HISTORY_CONTRACT',
  'FILL_CONTRACT',
  'PAGINATION_BOUNDARY',
  'RECOVERY_IDENTITY_CONSISTENCY',
])
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

async function loadAttestationPackage(
  env: BitgetAttestedRecoveryIngestionEnv,
  attestationId: string,
): Promise<AttestationPackageRow> {
  const row = await env.DB.prepare(`
    SELECT a.attestation_id,
           a.run_id AS certification_run_id,
           a.run_evidence_hash,
           r.exchange_account_id AS run_exchange_account_id,
           r.product_id AS run_product_id,
           r.status AS run_status,
           r.read_only_evidence_complete AS run_read_only_evidence_complete,
           r.permissions_verified AS run_permissions_verified,
           a.source_mode,
           a.environment AS certification_environment,
           a.source_ref,
           a.operator_actor_id,
           a.authorization_event_hash,
           a.attested_at,
           a.attestation_hash,
           a.external_read_only_evidence,
           r.certified_for_live AS run_certified_for_live,
           r.provider_mutation_allowed AS run_provider_mutation_allowed,
           r.automatic_retry_allowed AS run_automatic_retry_allowed,
           r.transfer_allowed AS run_transfer_allowed,
           r.withdrawal_allowed AS run_withdrawal_allowed,
           r.execution_allowed AS run_execution_allowed,
           r.credentials_persisted AS run_credentials_persisted,
           a.certification_check_projection_allowed AS attestation_certification_check_projection_allowed,
           a.certified_for_live AS attestation_certified_for_live,
           a.provider_mutation_allowed AS attestation_provider_mutation_allowed,
           a.automatic_retry_allowed AS attestation_automatic_retry_allowed,
           a.transfer_allowed AS attestation_transfer_allowed,
           a.withdrawal_allowed AS attestation_withdrawal_allowed,
           a.execution_allowed AS attestation_execution_allowed,
           a.credentials_persisted AS attestation_credentials_persisted
      FROM live_bitget_read_only_certification_attestations a
      JOIN live_bitget_read_only_certification_runs r ON r.run_id = a.run_id
     WHERE a.attestation_id = ?
     LIMIT 1
  `).bind(attestationId).first<AttestationPackageRow>()
  if (!row) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'Bitget read-only certification attestation is missing',
    )
  }
  return row
}

async function loadCertificationChecks(
  env: BitgetAttestedRecoveryIngestionEnv,
  runId: string,
): Promise<readonly CertificationCheckRow[]> {
  const result = await env.DB.prepare(`
    SELECT check_name, status, evidence_hash
      FROM live_bitget_read_only_certification_checks
     WHERE run_id = ?
     ORDER BY check_name ASC
  `).bind(runId).all<CertificationCheckRow>()
  return Object.freeze([...(result.results ?? [])])
}

async function assertAttestationPackage(
  row: AttestationPackageRow,
  checks: readonly CertificationCheckRow[],
): Promise<void> {
  const runEvidenceHash = sha256(row.run_evidence_hash, 'runEvidenceHash')
  const attestationHash = sha256(row.attestation_hash, 'attestationHash')
  if (
    row.run_status !== 'PASSED'
    || row.run_read_only_evidence_complete !== 1
    || row.run_permissions_verified !== 1
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'Bitget read-only certification run is incomplete, blocked, or failed',
    )
  }
  if (
    row.run_certified_for_live !== 0
    || row.run_provider_mutation_allowed !== 0
    || row.run_automatic_retry_allowed !== 0
    || row.run_transfer_allowed !== 0
    || row.run_withdrawal_allowed !== 0
    || row.run_execution_allowed !== 0
    || row.run_credentials_persisted !== 0
    || row.attestation_certification_check_projection_allowed !== 0
    || row.attestation_certified_for_live !== 0
    || row.attestation_provider_mutation_allowed !== 0
    || row.attestation_automatic_retry_allowed !== 0
    || row.attestation_transfer_allowed !== 0
    || row.attestation_withdrawal_allowed !== 0
    || row.attestation_execution_allowed !== 0
    || row.attestation_credentials_persisted !== 0
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'certification run or attestation violates permanent capability locks',
    )
  }

  const byName = new Map<string, CertificationCheckRow>()
  for (const check of checks) {
    sha256(check.evidence_hash, `checkEvidenceHash:${check.check_name}`)
    if (byName.has(check.check_name)) {
      throw new BitgetAttestedRecoveryIngestionConflictError(
        `duplicate certification check: ${check.check_name}`,
      )
    }
    byName.set(check.check_name, check)
  }
  if (
    byName.size !== REQUIRED_CHECKS.length
    || REQUIRED_CHECKS.some((name) => byName.get(name)?.status !== 'PASS')
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'attested recovery requires all eight read-only certification checks to pass',
    )
  }

  const external = row.source_mode === 'ISOLATED_READ_ONLY_CLIENT'
  if (
    (row.source_mode === 'INJECTED_FIXTURES'
      && (row.certification_environment !== 'LOCAL_TEST'
        || row.external_read_only_evidence !== 0
        || row.operator_actor_id !== null
        || row.authorization_event_hash !== null))
    || (external
      && (row.certification_environment === 'LOCAL_TEST'
        || row.external_read_only_evidence !== 1
        || !row.operator_actor_id
        || !row.authorization_event_hash))
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'certification attestation source and environment are inconsistent',
    )
  }
  const authorizationEventHash = row.authorization_event_hash === null
    ? null
    : sha256(row.authorization_event_hash, 'authorizationEventHash')
  const expectedAttestationHash = await canonicalHash({
    attestationId: row.attestation_id,
    runId: row.certification_run_id,
    runEvidenceHash,
    sourceMode: row.source_mode,
    environment: row.certification_environment,
    sourceRef: row.source_ref,
    operatorActorId: row.operator_actor_id,
    authorizationEventHash,
    attestedAt: isoTimestamp(row.attested_at, 'attestedAt'),
    externalReadOnlyEvidence: external,
    certificationCheckProjectionAllowed: false,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  })
  if (expectedAttestationHash !== attestationHash) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'Bitget read-only certification attestation hash is invalid',
    )
  }
}

async function validatePlan(
  row: AttestationPackageRow,
  plan: BitgetRecoveryIngestionPlan,
): Promise<void> {
  if (
    plan.provider !== 'BITGET'
    || plan.complete !== true
    || plan.bounded !== true
    || plan.readOnly !== true
    || plan.accountingApplied !== false
    || plan.reservationSettled !== false
    || plan.providerMutationAllowed !== false
    || plan.executionAllowed !== false
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'recovery ingestion plan violates permanent capability locks',
    )
  }
  if (
    plan.exchangeAccountId !== row.run_exchange_account_id
    || plan.productId !== row.run_product_id
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'recovery ingestion account or product does not match certification evidence',
    )
  }
  sha256(plan.snapshotHash, 'snapshotHash')
  sha256(plan.requestHash, 'requestHash')
  const suppliedIngestionHash = sha256(plan.ingestionHash, 'ingestionHash')
  required(plan.snapshotId, 'snapshotId')
  isoTimestamp(plan.recoveredAt, 'recoveredAt')

  if (plan.fillObservations.length !== plan.accountingTaskIntents.length) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'every recovered fill must have one accounting task intent',
    )
  }
  const fills = new Map<string, { fillHash: string; sequenceTimestamp: string }>()
  for (const fill of plan.fillObservations) {
    const fillId = required(fill.fillId, 'fillId')
    if (fills.has(fillId)) {
      throw new BitgetAttestedRecoveryIngestionConflictError(`duplicate recovered fill: ${fillId}`)
    }
    const fillHash = sha256(fill.fillHash, `fillHash:${fillId}`)
    let parsed: unknown
    try {
      parsed = JSON.parse(fill.fillJson) as unknown
    } catch {
      throw new BitgetAttestedRecoveryIngestionConflictError(`recovered fill JSON is invalid: ${fillId}`)
    }
    if (await canonicalHash(parsed) !== fillHash) {
      throw new BitgetAttestedRecoveryIngestionConflictError(`recovered fill hash is invalid: ${fillId}`)
    }
    fills.set(fillId, {
      fillHash,
      sequenceTimestamp: isoTimestamp(fill.sequenceTimestamp, `sequenceTimestamp:${fillId}`),
    })
  }
  for (const order of plan.orderObservations) {
    const identity = required(order.orderIdentity, 'orderIdentity')
    const orderHash = sha256(order.orderHash, `orderHash:${identity}`)
    let parsed: unknown
    try {
      parsed = JSON.parse(order.orderJson) as unknown
    } catch {
      throw new BitgetAttestedRecoveryIngestionConflictError(`recovered order JSON is invalid: ${identity}`)
    }
    if (await canonicalHash(parsed) !== orderHash) {
      throw new BitgetAttestedRecoveryIngestionConflictError(`recovered order hash is invalid: ${identity}`)
    }
  }

  const tasks = new Set<string>()
  for (const task of plan.accountingTaskIntents) {
    const taskIntentId = required(task.taskIntentId, 'taskIntentId')
    if (tasks.has(taskIntentId)) {
      throw new BitgetAttestedRecoveryIngestionConflictError(`duplicate accounting task: ${taskIntentId}`)
    }
    tasks.add(taskIntentId)
    const fill = fills.get(task.fillId)
    if (
      !fill
      || task.fillHash !== fill.fillHash
      || isoTimestamp(task.sequenceTimestamp, `taskSequenceTimestamp:${task.fillId}`) !== fill.sequenceTimestamp
      || task.status !== 'PENDING_ACCOUNTING'
      || task.accountingApplied !== false
      || task.reservationSettled !== false
      || task.providerMutationAllowed !== false
      || task.executionAllowed !== false
    ) {
      throw new BitgetAttestedRecoveryIngestionConflictError(
        `accounting task does not match immutable recovered fill evidence: ${task.fillId}`,
      )
    }
  }

  const { ingestionHash: _ignored, ...evidence } = plan
  if (await canonicalHash(evidence) !== suppliedIngestionHash) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'recovery ingestion plan hash is invalid',
    )
  }
}

async function loadBinding(
  env: BitgetAttestedRecoveryIngestionEnv,
  bindingId: string,
  attestationId: string,
  ingestionId: string,
): Promise<BindingRow | null> {
  return env.DB.prepare(`
    SELECT binding_id, attestation_id, certification_run_id,
           run_evidence_hash, attestation_hash, source_mode,
           certification_environment, external_read_only_evidence,
           ingestion_id, snapshot_id, snapshot_hash, ingestion_hash,
           exchange_account_id, product_id, accounting_task_count,
           linked_at, binding_hash, automatic_accounting_dispatch_allowed,
           reservation_settlement_allowed, certification_check_projection_allowed,
           certified_for_live, provider_mutation_allowed, automatic_retry_allowed,
           transfer_allowed, withdrawal_allowed, execution_allowed,
           credentials_persisted, reconciliation_required, incident_evidence_required
      FROM live_bitget_attested_recovery_ingestions
     WHERE binding_id = ? OR ingestion_id = ? OR (attestation_id = ? AND ingestion_id = ?)
     LIMIT 1
  `).bind(bindingId, ingestionId, attestationId, ingestionId).first<BindingRow>()
}

function assertBindingLocks(row: BindingRow): void {
  if (
    row.automatic_accounting_dispatch_allowed !== 0
    || row.reservation_settlement_allowed !== 0
    || row.certification_check_projection_allowed !== 0
    || row.certified_for_live !== 0
    || row.provider_mutation_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.transfer_allowed !== 0
    || row.withdrawal_allowed !== 0
    || row.execution_allowed !== 0
    || row.credentials_persisted !== 0
    || row.reconciliation_required !== 1
    || row.incident_evidence_required !== 1
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'stored attested recovery binding violates permanent capability locks',
    )
  }
}

function assertBindingCompatible(
  row: BindingRow,
  expected: Omit<BitgetAttestedRecoveryIngestionResult, 'persistenceStatus' | 'ingestionPersistenceStatus'>,
  linkedAt: string,
): void {
  assertBindingLocks(row)
  if (
    row.binding_id !== expected.bindingId
    || row.binding_hash !== expected.bindingHash
    || row.attestation_id !== expected.attestationId
    || row.certification_run_id !== expected.certificationRunId
    || row.run_evidence_hash !== expected.runEvidenceHash
    || row.attestation_hash !== expected.attestationHash
    || row.source_mode !== expected.sourceMode
    || row.certification_environment !== expected.certificationEnvironment
    || row.external_read_only_evidence !== (expected.externalReadOnlyEvidence ? 1 : 0)
    || row.ingestion_id !== expected.ingestionId
    || row.ingestion_hash !== expected.ingestionHash
    || row.snapshot_id !== expected.snapshotId
    || row.snapshot_hash !== expected.snapshotHash
    || row.exchange_account_id !== expected.exchangeAccountId
    || row.product_id !== expected.productId
    || row.accounting_task_count !== expected.accountingTaskCount
    || row.linked_at !== linkedAt
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'stored attested recovery binding conflicts with supplied evidence',
    )
  }
}

function result(
  persistenceStatus: BitgetAttestedRecoveryIngestionResult['persistenceStatus'],
  ingestionPersistenceStatus: PersistRecoveryIngestionResult['status'],
  evidence: Omit<BitgetAttestedRecoveryIngestionResult, 'persistenceStatus' | 'ingestionPersistenceStatus'>,
): BitgetAttestedRecoveryIngestionResult {
  return Object.freeze({ persistenceStatus, ingestionPersistenceStatus, ...evidence })
}

export async function persistAttestedBitgetRecoveryIngestion(
  env: BitgetAttestedRecoveryIngestionEnv,
  input: BitgetAttestedRecoveryIngestionInput,
  dependencies: BitgetAttestedRecoveryIngestionDependencies = {},
): Promise<BitgetAttestedRecoveryIngestionResult> {
  const bindingId = required(input.bindingId, 'bindingId')
  const attestationId = required(input.attestationId, 'attestationId')
  const linkedAt = isoTimestamp(input.linkedAt, 'linkedAt')
  const attestation = await loadAttestationPackage(env, attestationId)
  const checks = await loadCertificationChecks(env, attestation.certification_run_id)
  await assertAttestationPackage(attestation, checks)
  await validatePlan(attestation, input.plan)

  const bindingEvidence = {
    bindingId,
    attestationId,
    certificationRunId: attestation.certification_run_id,
    runEvidenceHash: attestation.run_evidence_hash,
    attestationHash: attestation.attestation_hash,
    sourceMode: attestation.source_mode,
    certificationEnvironment: attestation.certification_environment,
    externalReadOnlyEvidence: attestation.external_read_only_evidence === 1,
    ingestionId: input.plan.ingestionId,
    ingestionHash: input.plan.ingestionHash,
    snapshotId: input.plan.snapshotId,
    snapshotHash: input.plan.snapshotHash,
    exchangeAccountId: input.plan.exchangeAccountId,
    productId: input.plan.productId,
    accountingTaskCount: input.plan.accountingTaskIntents.length,
    automaticAccountingDispatchAllowed: false as const,
    reservationSettlementAllowed: false as const,
    certificationCheckProjectionAllowed: false as const,
    certifiedForLive: false as const,
    providerMutationAllowed: false as const,
    automaticRetryAllowed: false as const,
    transferAllowed: false as const,
    withdrawalAllowed: false as const,
    executionAllowed: false as const,
    credentialsPersisted: false as const,
    reconciliationRequired: true as const,
    incidentEvidenceRequired: true as const,
  }
  const bindingHash = await canonicalHash({ ...bindingEvidence, linkedAt })
  const evidence = Object.freeze({ ...bindingEvidence, bindingHash })

  const existing = await loadBinding(env, bindingId, attestationId, input.plan.ingestionId)
  if (existing) {
    assertBindingCompatible(existing, evidence, linkedAt)
    return result('REPLAYED', 'REPLAYED', evidence)
  }

  const persistIngestion = dependencies.persistIngestion ?? persistBitgetRecoveryIngestion
  const ingestion = await persistIngestion(env, input.plan)
  if (
    ingestion.ingestionId !== input.plan.ingestionId
    || ingestion.ingestionHash !== input.plan.ingestionHash
    || ingestion.snapshotId !== input.plan.snapshotId
    || ingestion.snapshotHash !== input.plan.snapshotHash
    || ingestion.accountingTaskCount !== input.plan.accountingTaskIntents.length
    || ingestion.accountingApplied !== false
    || ingestion.reservationSettled !== false
    || ingestion.providerMutationAllowed !== false
    || ingestion.executionAllowed !== false
  ) {
    throw new BitgetAttestedRecoveryIngestionConflictError(
      'recovery ingestion persistence result conflicts with attested evidence',
    )
  }

  const statements = [
    env.DB.prepare(`
      INSERT INTO live_bitget_attested_recovery_ingestions (
        binding_id, attestation_id, certification_run_id, run_evidence_hash,
        attestation_hash, source_mode, certification_environment,
        external_read_only_evidence, ingestion_id, snapshot_id, snapshot_hash,
        ingestion_hash, exchange_account_id, product_id, accounting_task_count,
        linked_at, binding_hash, automatic_accounting_dispatch_allowed,
        reservation_settlement_allowed, certification_check_projection_allowed,
        certified_for_live, provider_mutation_allowed, automatic_retry_allowed,
        transfer_allowed, withdrawal_allowed, execution_allowed,
        credentials_persisted, reconciliation_required, incident_evidence_required
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1)
    `).bind(
      bindingId,
      attestationId,
      attestation.certification_run_id,
      attestation.run_evidence_hash,
      attestation.attestation_hash,
      attestation.source_mode,
      attestation.certification_environment,
      attestation.external_read_only_evidence,
      input.plan.ingestionId,
      input.plan.snapshotId,
      input.plan.snapshotHash,
      input.plan.ingestionHash,
      input.plan.exchangeAccountId,
      input.plan.productId,
      input.plan.accountingTaskIntents.length,
      linkedAt,
      bindingHash,
    ),
    env.DB.prepare(`
      INSERT INTO live_bitget_attested_recovery_ingestion_events (
        binding_event_id, binding_id, attestation_id, ingestion_id,
        event_type, binding_hash, occurred_at
      ) VALUES (?, ?, ?, ?, 'ATTESTED_RECOVERY_BOUND', ?, ?)
    `).bind(
      `attested-recovery-event:${bindingHash.slice(0, 32)}`,
      bindingId,
      attestationId,
      input.plan.ingestionId,
      bindingHash,
      linkedAt,
    ),
  ]

  try {
    await env.DB.batch(statements)
  } catch (error) {
    const raced = await loadBinding(env, bindingId, attestationId, input.plan.ingestionId)
    if (!raced) throw error
    assertBindingCompatible(raced, evidence, linkedAt)
    return result('REPLAYED', ingestion.status, evidence)
  }

  const projected = await loadBinding(env, bindingId, attestationId, input.plan.ingestionId)
  if (!projected) throw new Error('attested recovery binding is missing after D1 batch')
  assertBindingCompatible(projected, evidence, linkedAt)
  return result('BOUND', ingestion.status, evidence)
}
