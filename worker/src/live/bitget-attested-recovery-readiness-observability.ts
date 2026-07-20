import { canonicalHash, canonicalJson } from './canonical-json.ts'
import {
  openOrRefreshAlert,
  recordMetricSample,
  resolveAlert,
  type ObservabilityEnv,
} from './observability-store.ts'
import type { OperationalAlert } from './observability.ts'
import type {
  BitgetAttestedRecoveryDispatchStatus,
  BitgetAttestedRecoveryReadinessStatus,
  BitgetAttestedRecoveryReconciliationStatus,
} from './bitget-attested-recovery-readiness.ts'
import type { BitgetReadOnlyCertificationSourceMode } from './bitget-read-only-certification-attestation.ts'

export interface BitgetAttestedRecoveryReadinessObservabilityInput {
  checkpointId: string
  correlationId: string
  auditEventHash: string
}

export interface BitgetAttestedRecoveryReadinessObservabilityResult {
  checkpointId: string
  bindingId: string
  checkpointHash: string
  status: BitgetAttestedRecoveryReadinessStatus
  action: 'OPENED_OR_REFRESHED' | 'RESOLVED' | 'NO_ACTION'
  alertId: string
  alertKey: string
  incidentRequired: boolean
  automaticAccountingDispatchAllowed: false
  automaticReservationSettlementAllowed: false
  automaticReconciliationAllowed: false
  guardianMutationAllowed: false
  providerMutationAllowed: false
  automaticRetryAllowed: false
  executionAllowed: false
}

export interface BitgetAttestedRecoveryReadinessObservabilityDependencies {
  recordMetric?: typeof recordMetricSample
  openAlert?: typeof openOrRefreshAlert
  resolveAlert?: typeof resolveAlert
}

export class BitgetAttestedRecoveryReadinessObservabilityConflictError extends Error {
  readonly code = 'BITGET_ATTESTED_RECOVERY_READINESS_OBSERVABILITY_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'BitgetAttestedRecoveryReadinessObservabilityConflictError'
  }
}

type CheckpointRow = {
  checkpoint_id: string
  binding_id: string
  binding_hash: string
  attestation_id: string
  ingestion_id: string
  exchange_account_id: string
  product_id: string
  source_mode: BitgetReadOnlyCertificationSourceMode
  external_read_only_evidence: number
  status: BitgetAttestedRecoveryReadinessStatus
  reasons_json: string
  accounting_task_count: number
  accounting_receipt_count: number
  reservation_required_count: number
  settlement_receipt_count: number
  dispatch_status: BitgetAttestedRecoveryDispatchStatus
  reconciliation_status: BitgetAttestedRecoveryReconciliationStatus
  latest_accounted_at: string | null
  latest_settled_at: string | null
  latest_reconciled_at: string | null
  oldest_task_at: string | null
  evaluated_at: string
  checkpoint_hash: string
  incident_required: number
  operator_review_required: number
  automatic_accounting_dispatch_allowed: number
  automatic_reservation_settlement_allowed: number
  automatic_reconciliation_allowed: number
  certification_check_projection_allowed: number
  certified_for_live: number
  provider_mutation_allowed: number
  automatic_retry_allowed: number
  transfer_allowed: number
  withdrawal_allowed: number
  execution_allowed: number
  credentials_persisted: number
}

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

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function nullableTimestamp(value: string | null, field: string): string | null {
  return value === null ? null : timestamp(value, field)
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      `${field} must be a non-negative safe integer`,
    )
  }
  return value
}

function parseReasons(value: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'readiness reasons JSON is invalid',
    )
  }
  if (!Array.isArray(parsed) || parsed.some((reason) => typeof reason !== 'string')) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'readiness reasons must be a string array',
    )
  }
  const reasons = Object.freeze([...new Set(parsed)].sort())
  if (canonicalJson(reasons) !== value) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'readiness reasons JSON is not canonical',
    )
  }
  return reasons
}

async function loadCheckpoint(
  env: ObservabilityEnv,
  checkpointId: string,
): Promise<CheckpointRow> {
  const row = await env.DB.prepare(`
    SELECT checkpoint_id, binding_id, binding_hash, attestation_id,
           ingestion_id, exchange_account_id, product_id, source_mode,
           external_read_only_evidence, status, reasons_json,
           accounting_task_count, accounting_receipt_count,
           reservation_required_count, settlement_receipt_count,
           dispatch_status, reconciliation_status, latest_accounted_at,
           latest_settled_at, latest_reconciled_at, oldest_task_at,
           evaluated_at, checkpoint_hash, incident_required,
           operator_review_required, automatic_accounting_dispatch_allowed,
           automatic_reservation_settlement_allowed,
           automatic_reconciliation_allowed,
           certification_check_projection_allowed, certified_for_live,
           provider_mutation_allowed, automatic_retry_allowed,
           transfer_allowed, withdrawal_allowed, execution_allowed,
           credentials_persisted
      FROM live_bitget_attested_recovery_readiness
     WHERE checkpoint_id = ?
     LIMIT 1
  `).bind(checkpointId).first<CheckpointRow>()
  if (!row) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'attested recovery readiness checkpoint is missing',
    )
  }
  return row
}

async function validateCheckpoint(row: CheckpointRow): Promise<{
  reasons: readonly string[]
  checkpointHash: string
  evaluatedAt: string
}> {
  const checkpointHash = sha256(row.checkpoint_hash, 'checkpointHash')
  const bindingHash = sha256(row.binding_hash, 'bindingHash')
  const evaluatedAt = timestamp(row.evaluated_at, 'evaluatedAt')
  const reasons = parseReasons(row.reasons_json)
  const accountingTaskCount = nonNegativeInteger(row.accounting_task_count, 'accountingTaskCount')
  const accountingReceiptCount = nonNegativeInteger(row.accounting_receipt_count, 'accountingReceiptCount')
  const reservationRequiredCount = nonNegativeInteger(row.reservation_required_count, 'reservationRequiredCount')
  const settlementReceiptCount = nonNegativeInteger(row.settlement_receipt_count, 'settlementReceiptCount')
  if (
    accountingReceiptCount > accountingTaskCount
    || reservationRequiredCount > accountingTaskCount
    || settlementReceiptCount > accountingTaskCount
  ) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'readiness checkpoint counts are inconsistent',
    )
  }
  if (
    row.automatic_accounting_dispatch_allowed !== 0
    || row.automatic_reservation_settlement_allowed !== 0
    || row.automatic_reconciliation_allowed !== 0
    || row.certification_check_projection_allowed !== 0
    || row.certified_for_live !== 0
    || row.provider_mutation_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.transfer_allowed !== 0
    || row.withdrawal_allowed !== 0
    || row.execution_allowed !== 0
    || row.credentials_persisted !== 0
  ) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'readiness checkpoint violates permanent capability locks',
    )
  }
  if (
    (row.status === 'CLEAR'
      && (reasons.length !== 0 || row.incident_required !== 0 || row.operator_review_required !== 0))
    || (row.status === 'HALT_FOR_REVIEW'
      && (row.incident_required !== 1 || row.operator_review_required !== 1))
    || (!['CLEAR', 'HALT_FOR_REVIEW'].includes(row.status)
      && row.operator_review_required !== 1)
  ) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'readiness status conflicts with incident or operator-review evidence',
    )
  }

  const evidence = {
    checkpointId: required(row.checkpoint_id, 'checkpointId'),
    bindingId: required(row.binding_id, 'bindingId'),
    bindingHash,
    attestationId: required(row.attestation_id, 'attestationId'),
    ingestionId: required(row.ingestion_id, 'ingestionId'),
    exchangeAccountId: required(row.exchange_account_id, 'exchangeAccountId'),
    productId: required(row.product_id, 'productId'),
    sourceMode: row.source_mode,
    externalReadOnlyEvidence: row.external_read_only_evidence === 1,
    status: row.status,
    reasons,
    accountingTaskCount,
    accountingReceiptCount,
    reservationRequiredCount,
    settlementReceiptCount,
    dispatchStatus: row.dispatch_status,
    reconciliationStatus: row.reconciliation_status,
    latestAccountedAt: nullableTimestamp(row.latest_accounted_at, 'latestAccountedAt'),
    latestSettledAt: nullableTimestamp(row.latest_settled_at, 'latestSettledAt'),
    latestReconciledAt: nullableTimestamp(row.latest_reconciled_at, 'latestReconciledAt'),
    oldestTaskAt: nullableTimestamp(row.oldest_task_at, 'oldestTaskAt'),
    evaluatedAt,
    incidentRequired: row.incident_required === 1,
    operatorReviewRequired: row.operator_review_required === 1,
    automaticAccountingDispatchAllowed: false,
    automaticReservationSettlementAllowed: false,
    automaticReconciliationAllowed: false,
    certificationCheckProjectionAllowed: false,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  }
  if (await canonicalHash(evidence) !== checkpointHash) {
    throw new BitgetAttestedRecoveryReadinessObservabilityConflictError(
      'readiness checkpoint hash is invalid',
    )
  }
  return { reasons, checkpointHash, evaluatedAt }
}

function alertForCheckpoint(
  row: CheckpointRow,
  reasons: readonly string[],
): OperationalAlert {
  const halted = row.status === 'HALT_FOR_REVIEW'
  return Object.freeze({
    alertKey: `bitget-attested-recovery-readiness:${row.binding_id}`,
    severity: halted ? 'CRITICAL' : 'WARNING',
    reasonCode: halted
      ? 'BITGET_ATTESTED_RECOVERY_HALTED'
      : 'BITGET_ATTESTED_RECOVERY_BACKLOG_STALE',
    summary: halted
      ? 'Attested Bitget recovery evidence requires immediate review'
      : 'Attested Bitget recovery evidence is stale and incomplete',
    detail: Object.freeze({
      checkpointId: row.checkpoint_id,
      bindingId: row.binding_id,
      productId: row.product_id,
      status: row.status,
      reasonsJson: canonicalJson(reasons),
      accountingTaskCount: row.accounting_task_count,
      accountingReceiptCount: row.accounting_receipt_count,
      reservationRequiredCount: row.reservation_required_count,
      settlementReceiptCount: row.settlement_receipt_count,
      externalReadOnlyEvidence: row.external_read_only_evidence === 1,
    }),
    guardianAction: halted ? 'HALT_ACCOUNT' : 'RESTRICT_ACCOUNT',
  })
}

export async function projectBitgetAttestedRecoveryReadinessObservability(
  env: ObservabilityEnv,
  input: BitgetAttestedRecoveryReadinessObservabilityInput,
  dependencies: BitgetAttestedRecoveryReadinessObservabilityDependencies = {},
): Promise<BitgetAttestedRecoveryReadinessObservabilityResult> {
  const checkpointId = required(input.checkpointId, 'checkpointId')
  const correlationId = required(input.correlationId, 'correlationId')
  const auditEventHash = sha256(input.auditEventHash, 'auditEventHash')
  const row = await loadCheckpoint(env, checkpointId)
  const validated = await validateCheckpoint(row)
  const alertId = `attested-recovery-readiness-alert:${row.binding_hash.slice(0, 32)}`
  const alertKey = `bitget-attested-recovery-readiness:${row.binding_id}`
  const recordMetric = dependencies.recordMetric ?? recordMetricSample
  const openAlert = dependencies.openAlert ?? openOrRefreshAlert
  const resolve = dependencies.resolveAlert ?? resolveAlert

  await recordMetric(env, {
    metricSampleId: `attested-recovery-readiness-metric:${validated.checkpointHash.slice(0, 32)}`,
    exchangeAccountId: row.exchange_account_id,
    metricName: 'bitget_attested_recovery_readiness_status',
    metricValue: row.status,
    metricUnit: 'state',
    labels: {
      bindingId: row.binding_id,
      productId: row.product_id,
      sourceMode: row.source_mode,
      externalReadOnlyEvidence: row.external_read_only_evidence === 1,
      incidentRequired: row.incident_required === 1,
    },
    observedAt: validated.evaluatedAt,
  })

  let action: BitgetAttestedRecoveryReadinessObservabilityResult['action'] = 'NO_ACTION'
  if (row.incident_required === 1) {
    await openAlert(env, {
      alertId,
      alertEventId: `attested-recovery-readiness-alert-event:${validated.checkpointHash.slice(0, 32)}`,
      exchangeAccountId: row.exchange_account_id,
      alert: alertForCheckpoint(row, validated.reasons),
      correlationId,
      auditEventHash,
      observedAt: validated.evaluatedAt,
    })
    action = 'OPENED_OR_REFRESHED'
  } else if (row.status === 'CLEAR') {
    const resolved = await resolve(env, {
      alertId,
      alertEventId: `attested-recovery-readiness-resolved:${validated.checkpointHash.slice(0, 32)}`,
      actorId: null,
      reasonCode: 'BITGET_ATTESTED_RECOVERY_CLEAR',
      detail: {
        checkpointId: row.checkpoint_id,
        bindingId: row.binding_id,
        productId: row.product_id,
        checkpointHash: validated.checkpointHash,
      },
      correlationId,
      auditEventHash,
      occurredAt: validated.evaluatedAt,
    })
    action = resolved ? 'RESOLVED' : 'NO_ACTION'
  }

  return Object.freeze({
    checkpointId: row.checkpoint_id,
    bindingId: row.binding_id,
    checkpointHash: validated.checkpointHash,
    status: row.status,
    action,
    alertId,
    alertKey,
    incidentRequired: row.incident_required === 1,
    automaticAccountingDispatchAllowed: false,
    automaticReservationSettlementAllowed: false,
    automaticReconciliationAllowed: false,
    guardianMutationAllowed: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    executionAllowed: false,
  })
}
