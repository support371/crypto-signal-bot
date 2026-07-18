import { canonicalHash, canonicalJson } from './canonical-json.ts'
import type {
  BitgetReadOnlyCertificationSourceMode,
} from './bitget-read-only-certification-attestation.ts'

export type BitgetAttestedRecoveryReadinessStatus =
  | 'PENDING_ACCOUNTING_REVIEW'
  | 'PENDING_SETTLEMENT'
  | 'PENDING_RECONCILIATION'
  | 'CLEAR'
  | 'HALT_FOR_REVIEW'

export type BitgetAttestedRecoveryDispatchStatus =
  | 'NOT_STARTED'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'

export type BitgetAttestedRecoveryReconciliationStatus =
  | 'NOT_RUN'
  | 'CLEAR'
  | 'HALT_FOR_REVIEW'

export interface BitgetAttestedRecoveryReadinessEnv {
  DB: D1Database
}

export interface BitgetAttestedRecoveryReadinessInput {
  checkpointId: string
  bindingId: string
  evaluatedAt: string
}

export interface BitgetAttestedRecoveryReadinessResult {
  persistenceStatus: 'PROJECTED' | 'REPLAYED'
  checkpointId: string
  bindingId: string
  bindingHash: string
  attestationId: string
  ingestionId: string
  exchangeAccountId: string
  productId: string
  sourceMode: BitgetReadOnlyCertificationSourceMode
  externalReadOnlyEvidence: boolean
  status: BitgetAttestedRecoveryReadinessStatus
  reasons: readonly string[]
  accountingTaskCount: number
  accountingReceiptCount: number
  reservationRequiredCount: number
  settlementReceiptCount: number
  dispatchStatus: BitgetAttestedRecoveryDispatchStatus
  reconciliationStatus: BitgetAttestedRecoveryReconciliationStatus
  latestAccountedAt: string | null
  latestSettledAt: string | null
  latestReconciledAt: string | null
  oldestTaskAt: string | null
  evaluatedAt: string
  checkpointHash: string
  incidentRequired: boolean
  operatorReviewRequired: boolean
  automaticAccountingDispatchAllowed: false
  automaticReservationSettlementAllowed: false
  automaticReconciliationAllowed: false
  certificationCheckProjectionAllowed: false
  certifiedForLive: false
  providerMutationAllowed: false
  automaticRetryAllowed: false
  transferAllowed: false
  withdrawalAllowed: false
  executionAllowed: false
  credentialsPersisted: false
}

export class BitgetAttestedRecoveryReadinessConflictError extends Error {
  readonly code = 'BITGET_ATTESTED_RECOVERY_READINESS_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'BitgetAttestedRecoveryReadinessConflictError'
  }
}

type BindingRow = {
  binding_id: string
  binding_hash: string
  attestation_id: string
  ingestion_id: string
  snapshot_hash: string
  exchange_account_id: string
  product_id: string
  source_mode: BitgetReadOnlyCertificationSourceMode
  external_read_only_evidence: number
  accounting_task_count: number
  linked_at: string
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

type IngestionRow = {
  ingestion_id: string
  snapshot_hash: string
  ingestion_hash: string
  exchange_account_id: string
  product_id: string
  accounting_task_count: number
  complete: number
  bounded: number
  read_only: number
  accounting_applied: number
  reservation_settled: number
  provider_mutation_allowed: number
  execution_allowed: number
}

type TaskEvidenceRow = {
  fill_id: string
  sequence_timestamp: string
  internal_order_id: string | null
  reservation_count: number
  accounting_receipt_id: string | null
  accounting_hash: string | null
  accounted_at: string | null
  accounting_provider_mutation_allowed: number | null
  accounting_reservation_applied: number | null
  accounting_execution_allowed: number | null
  settlement_receipt_id: string | null
  settlement_hash: string | null
  settled_at: string | null
  settlement_provider_mutation_allowed: number | null
  settlement_execution_allowed: number | null
}

type DispatchRow = {
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  command_count: number
  completed_command_count: number
  automatically_dispatched: number
  automatically_retried: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
  occurred_at: string
}

type ReconciliationRow = {
  status: 'CLEAR' | 'HALT_FOR_REVIEW'
  reasons_json: string
  reconciliation_hash: string
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
  observed_at: string
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
const STALE_AFTER_MS = 15 * 60 * 1000

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

function timestamp(value: string, field: string): { iso: string; milliseconds: number } {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${field} must be ISO-8601`)
  return { iso: new Date(milliseconds).toISOString(), milliseconds }
}

function maximumTimestamp(values: readonly (string | null)[]): string | null {
  let selected: { iso: string; milliseconds: number } | null = null
  for (const value of values) {
    if (value === null) continue
    const parsed = timestamp(value, 'evidenceTimestamp')
    if (!selected || parsed.milliseconds > selected.milliseconds) selected = parsed
  }
  return selected?.iso ?? null
}

function minimumTimestamp(values: readonly string[]): string | null {
  let selected: { iso: string; milliseconds: number } | null = null
  for (const value of values) {
    const parsed = timestamp(value, 'taskTimestamp')
    if (!selected || parsed.milliseconds < selected.milliseconds) selected = parsed
  }
  return selected?.iso ?? null
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort())
}

async function loadBinding(
  env: BitgetAttestedRecoveryReadinessEnv,
  bindingId: string,
): Promise<BindingRow> {
  const row = await env.DB.prepare(`
    SELECT binding_id, binding_hash, attestation_id, ingestion_id, snapshot_hash,
           exchange_account_id, product_id, source_mode,
           external_read_only_evidence, accounting_task_count, linked_at,
           automatic_accounting_dispatch_allowed, reservation_settlement_allowed,
           certification_check_projection_allowed, certified_for_live,
           provider_mutation_allowed, automatic_retry_allowed, transfer_allowed,
           withdrawal_allowed, execution_allowed, credentials_persisted,
           reconciliation_required, incident_evidence_required
      FROM live_bitget_attested_recovery_ingestions
     WHERE binding_id = ?
     LIMIT 1
  `).bind(bindingId).first<BindingRow>()
  if (!row) throw new BitgetAttestedRecoveryReadinessConflictError('attested recovery binding is missing')
  sha256(row.binding_hash, 'bindingHash')
  timestamp(row.linked_at, 'linkedAt')
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
    throw new BitgetAttestedRecoveryReadinessConflictError(
      'attested recovery binding violates permanent capability locks',
    )
  }
  return row
}

async function loadIngestion(
  env: BitgetAttestedRecoveryReadinessEnv,
  binding: BindingRow,
): Promise<IngestionRow> {
  const row = await env.DB.prepare(`
    SELECT ingestion_id, snapshot_hash, ingestion_hash, exchange_account_id,
           product_id, accounting_task_count, complete, bounded, read_only,
           accounting_applied, reservation_settled,
           provider_mutation_allowed, execution_allowed
      FROM live_recovery_ingestions
     WHERE ingestion_id = ?
     LIMIT 1
  `).bind(binding.ingestion_id).first<IngestionRow>()
  if (!row) throw new BitgetAttestedRecoveryReadinessConflictError('recovery ingestion is missing')
  sha256(row.snapshot_hash, 'snapshotHash')
  sha256(row.ingestion_hash, 'ingestionHash')
  if (
    row.ingestion_id !== binding.ingestion_id
    || row.snapshot_hash !== binding.snapshot_hash
    || row.exchange_account_id !== binding.exchange_account_id
    || row.product_id !== binding.product_id
    || row.accounting_task_count !== binding.accounting_task_count
    || row.complete !== 1
    || row.bounded !== 1
    || row.read_only !== 1
    || row.accounting_applied !== 0
    || row.reservation_settled !== 0
    || row.provider_mutation_allowed !== 0
    || row.execution_allowed !== 0
  ) {
    throw new BitgetAttestedRecoveryReadinessConflictError(
      'recovery ingestion conflicts with attested binding or capability locks',
    )
  }
  return row
}

async function loadTaskEvidence(
  env: BitgetAttestedRecoveryReadinessEnv,
  ingestionId: string,
): Promise<readonly TaskEvidenceRow[]> {
  const result = await env.DB.prepare(`
    SELECT t.fill_id,
           t.sequence_timestamp,
           f.internal_order_id,
           CASE WHEN f.internal_order_id IS NULL THEN 0 ELSE (
             SELECT COUNT(*)
               FROM reservations rs
              WHERE rs.exchange_account_id = t.exchange_account_id
                AND rs.order_id = f.internal_order_id
           ) END AS reservation_count,
           a.accounting_receipt_id,
           a.accounting_hash,
           a.accounted_at,
           a.provider_mutation_allowed AS accounting_provider_mutation_allowed,
           a.reservation_applied AS accounting_reservation_applied,
           a.execution_allowed AS accounting_execution_allowed,
           s.settlement_receipt_id,
           s.settlement_hash,
           s.settled_at,
           s.provider_mutation_allowed AS settlement_provider_mutation_allowed,
           s.execution_allowed AS settlement_execution_allowed
      FROM live_recovery_accounting_task_intents t
      LEFT JOIN live_fills f ON f.fill_id = t.fill_id
      LEFT JOIN live_fill_accounting_receipts a ON a.fill_id = t.fill_id
      LEFT JOIN live_reservation_settlement_receipts s ON s.fill_id = t.fill_id
     WHERE t.ingestion_id = ?
     ORDER BY t.sequence_timestamp ASC, t.fill_id ASC
  `).bind(ingestionId).all<TaskEvidenceRow>()
  return Object.freeze([...(result.results ?? [])])
}

async function loadLatestDispatch(
  env: BitgetAttestedRecoveryReadinessEnv,
  snapshotHash: string,
): Promise<DispatchRow | null> {
  return env.DB.prepare(`
    SELECT d.status, d.command_count, d.completed_command_count,
           d.automatically_dispatched, d.automatically_retried,
           d.provider_mutation_allowed, d.reservation_applied,
           d.execution_allowed, d.occurred_at
      FROM live_recovery_accounting_plans p
      JOIN live_recovery_accounting_dispatches d ON d.plan_id = p.plan_id
     WHERE p.recovery_snapshot_hash = ?
     ORDER BY d.occurred_at DESC, d.dispatch_id DESC
     LIMIT 1
  `).bind(snapshotHash).first<DispatchRow>()
}

async function loadLatestReconciliation(
  env: BitgetAttestedRecoveryReadinessEnv,
  binding: BindingRow,
): Promise<ReconciliationRow | null> {
  return env.DB.prepare(`
    SELECT status, reasons_json, reconciliation_hash,
           provider_mutation_allowed, reservation_applied,
           execution_allowed, observed_at
      FROM live_fill_accounting_reconciliations
     WHERE exchange_name = 'BITGET'
       AND exchange_account_id = ?
       AND product_id = ?
     ORDER BY observed_at DESC, reconciliation_id DESC
     LIMIT 1
  `).bind(binding.exchange_account_id, binding.product_id).first<ReconciliationRow>()
}

function validateTaskEvidence(
  tasks: readonly TaskEvidenceRow[],
  expectedCount: number,
): {
  accountingReceiptCount: number
  reservationRequiredCount: number
  settlementReceiptCount: number
  latestAccountedAt: string | null
  latestSettledAt: string | null
  oldestTaskAt: string | null
  haltReasons: readonly string[]
} {
  if (tasks.length !== expectedCount) {
    throw new BitgetAttestedRecoveryReadinessConflictError(
      'accounting task count conflicts with immutable ingestion evidence',
    )
  }
  const fills = new Set<string>()
  const accountedAt: string[] = []
  const settledAt: string[] = []
  const taskTimes: string[] = []
  const haltReasons: string[] = []
  let accountingReceiptCount = 0
  let reservationRequiredCount = 0
  let settlementReceiptCount = 0

  for (const task of tasks) {
    const fillId = required(task.fill_id, 'fillId')
    if (fills.has(fillId)) {
      throw new BitgetAttestedRecoveryReadinessConflictError(`duplicate accounting task fill: ${fillId}`)
    }
    fills.add(fillId)
    taskTimes.push(timestamp(task.sequence_timestamp, `sequenceTimestamp:${fillId}`).iso)

    if (task.reservation_count < 0 || !Number.isSafeInteger(task.reservation_count)) {
      throw new BitgetAttestedRecoveryReadinessConflictError(`reservation count is invalid: ${fillId}`)
    }
    if (task.reservation_count > 1) haltReasons.push(`multiple_reservations:${fillId}`)

    if (task.accounting_receipt_id !== null) {
      accountingReceiptCount += 1
      if (
        !task.accounting_hash
        || task.accounted_at === null
        || task.accounting_provider_mutation_allowed !== 0
        || task.accounting_reservation_applied !== 0
        || task.accounting_execution_allowed !== 0
      ) {
        throw new BitgetAttestedRecoveryReadinessConflictError(
          `accounting receipt violates immutable capability locks: ${fillId}`,
        )
      }
      sha256(task.accounting_hash, `accountingHash:${fillId}`)
      accountedAt.push(timestamp(task.accounted_at, `accountedAt:${fillId}`).iso)
    } else if (
      task.accounting_hash !== null
      || task.accounted_at !== null
      || task.accounting_provider_mutation_allowed !== null
      || task.accounting_reservation_applied !== null
      || task.accounting_execution_allowed !== null
    ) {
      throw new BitgetAttestedRecoveryReadinessConflictError(
        `partial accounting receipt evidence exists: ${fillId}`,
      )
    }

    if (task.reservation_count === 1) reservationRequiredCount += 1
    if (task.settlement_receipt_id !== null) {
      settlementReceiptCount += 1
      if (task.reservation_count !== 1) haltReasons.push(`orphan_settlement:${fillId}`)
      if (
        !task.settlement_hash
        || task.settled_at === null
        || task.settlement_provider_mutation_allowed !== 0
        || task.settlement_execution_allowed !== 0
      ) {
        throw new BitgetAttestedRecoveryReadinessConflictError(
          `settlement receipt violates immutable capability locks: ${fillId}`,
        )
      }
      sha256(task.settlement_hash, `settlementHash:${fillId}`)
      settledAt.push(timestamp(task.settled_at, `settledAt:${fillId}`).iso)
    } else if (
      task.settlement_hash !== null
      || task.settled_at !== null
      || task.settlement_provider_mutation_allowed !== null
      || task.settlement_execution_allowed !== null
    ) {
      throw new BitgetAttestedRecoveryReadinessConflictError(
        `partial settlement receipt evidence exists: ${fillId}`,
      )
    }
  }

  return {
    accountingReceiptCount,
    reservationRequiredCount,
    settlementReceiptCount,
    latestAccountedAt: maximumTimestamp(accountedAt),
    latestSettledAt: maximumTimestamp(settledAt),
    oldestTaskAt: minimumTimestamp(taskTimes),
    haltReasons: uniqueSorted(haltReasons),
  }
}

function validateDispatch(
  dispatch: DispatchRow | null,
  taskCount: number,
  accountingReceiptCount: number,
): { status: BitgetAttestedRecoveryDispatchStatus; haltReasons: readonly string[]; occurredAt: string | null } {
  if (!dispatch) {
    return {
      status: 'NOT_STARTED',
      haltReasons: accountingReceiptCount > 0 ? Object.freeze(['accounting_receipts_without_dispatch']) : Object.freeze([]),
      occurredAt: null,
    }
  }
  timestamp(dispatch.occurred_at, 'dispatchOccurredAt')
  if (
    dispatch.automatically_dispatched !== 0
    || dispatch.automatically_retried !== 0
    || dispatch.provider_mutation_allowed !== 0
    || dispatch.reservation_applied !== 0
    || dispatch.execution_allowed !== 0
  ) {
    throw new BitgetAttestedRecoveryReadinessConflictError(
      'recovery accounting dispatch violates permanent capability locks',
    )
  }
  if (
    !Number.isSafeInteger(dispatch.command_count)
    || !Number.isSafeInteger(dispatch.completed_command_count)
    || dispatch.command_count < 0
    || dispatch.completed_command_count < 0
    || dispatch.completed_command_count > dispatch.command_count
  ) {
    throw new BitgetAttestedRecoveryReadinessConflictError('dispatch command counts are invalid')
  }
  const reasons: string[] = []
  if (dispatch.status === 'PARTIAL') reasons.push('accounting_dispatch_partial')
  if (dispatch.status === 'FAILED') reasons.push('accounting_dispatch_failed')
  if (
    dispatch.status === 'COMPLETED'
    && (dispatch.command_count !== taskCount
      || dispatch.completed_command_count !== taskCount
      || accountingReceiptCount !== taskCount)
  ) {
    reasons.push('completed_dispatch_receipt_count_mismatch')
  }
  return {
    status: dispatch.status,
    haltReasons: uniqueSorted(reasons),
    occurredAt: timestamp(dispatch.occurred_at, 'dispatchOccurredAt').iso,
  }
}

function validateReconciliation(
  row: ReconciliationRow | null,
): { status: BitgetAttestedRecoveryReconciliationStatus; observedAt: string | null; haltReasons: readonly string[] } {
  if (!row) return { status: 'NOT_RUN', observedAt: null, haltReasons: Object.freeze([]) }
  sha256(row.reconciliation_hash, 'reconciliationHash')
  if (
    row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new BitgetAttestedRecoveryReadinessConflictError(
      'reconciliation evidence violates permanent capability locks',
    )
  }
  let parsedReasons: unknown
  try {
    parsedReasons = JSON.parse(row.reasons_json) as unknown
  } catch {
    throw new BitgetAttestedRecoveryReadinessConflictError('reconciliation reasons JSON is invalid')
  }
  if (!Array.isArray(parsedReasons) || parsedReasons.some((reason) => typeof reason !== 'string')) {
    throw new BitgetAttestedRecoveryReadinessConflictError('reconciliation reasons must be a string array')
  }
  return {
    status: row.status,
    observedAt: timestamp(row.observed_at, 'reconciliationObservedAt').iso,
    haltReasons: row.status === 'HALT_FOR_REVIEW'
      ? uniqueSorted(['reconciliation_halt', ...parsedReasons])
      : Object.freeze([]),
  }
}

async function loadCheckpoint(
  env: BitgetAttestedRecoveryReadinessEnv,
  checkpointId: string,
  bindingId: string,
  evaluatedAt: string,
): Promise<CheckpointRow | null> {
  return env.DB.prepare(`
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
     WHERE checkpoint_id = ? OR (binding_id = ? AND evaluated_at = ?)
     LIMIT 1
  `).bind(checkpointId, bindingId, evaluatedAt).first<CheckpointRow>()
}

function assertCheckpointLocks(row: CheckpointRow): void {
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
    throw new BitgetAttestedRecoveryReadinessConflictError(
      'stored readiness checkpoint violates permanent capability locks',
    )
  }
}

function assertCheckpointCompatible(
  row: CheckpointRow,
  expected: Omit<BitgetAttestedRecoveryReadinessResult, 'persistenceStatus'>,
): void {
  assertCheckpointLocks(row)
  if (
    row.checkpoint_id !== expected.checkpointId
    || row.binding_id !== expected.bindingId
    || row.binding_hash !== expected.bindingHash
    || row.attestation_id !== expected.attestationId
    || row.ingestion_id !== expected.ingestionId
    || row.exchange_account_id !== expected.exchangeAccountId
    || row.product_id !== expected.productId
    || row.source_mode !== expected.sourceMode
    || row.external_read_only_evidence !== (expected.externalReadOnlyEvidence ? 1 : 0)
    || row.status !== expected.status
    || row.reasons_json !== canonicalJson(expected.reasons)
    || row.accounting_task_count !== expected.accountingTaskCount
    || row.accounting_receipt_count !== expected.accountingReceiptCount
    || row.reservation_required_count !== expected.reservationRequiredCount
    || row.settlement_receipt_count !== expected.settlementReceiptCount
    || row.dispatch_status !== expected.dispatchStatus
    || row.reconciliation_status !== expected.reconciliationStatus
    || row.latest_accounted_at !== expected.latestAccountedAt
    || row.latest_settled_at !== expected.latestSettledAt
    || row.latest_reconciled_at !== expected.latestReconciledAt
    || row.oldest_task_at !== expected.oldestTaskAt
    || row.evaluated_at !== expected.evaluatedAt
    || row.checkpoint_hash !== expected.checkpointHash
    || row.incident_required !== (expected.incidentRequired ? 1 : 0)
    || row.operator_review_required !== (expected.operatorReviewRequired ? 1 : 0)
  ) {
    throw new BitgetAttestedRecoveryReadinessConflictError(
      'stored readiness checkpoint conflicts with supplied evidence',
    )
  }
}

export async function evaluateAndPersistBitgetAttestedRecoveryReadiness(
  env: BitgetAttestedRecoveryReadinessEnv,
  input: BitgetAttestedRecoveryReadinessInput,
): Promise<BitgetAttestedRecoveryReadinessResult> {
  const checkpointId = required(input.checkpointId, 'checkpointId')
  const bindingId = required(input.bindingId, 'bindingId')
  const evaluated = timestamp(input.evaluatedAt, 'evaluatedAt')
  const binding = await loadBinding(env, bindingId)
  await loadIngestion(env, binding)
  const taskEvidence = await loadTaskEvidence(env, binding.ingestion_id)
  const taskSummary = validateTaskEvidence(taskEvidence, binding.accounting_task_count)
  const dispatch = validateDispatch(
    await loadLatestDispatch(env, binding.snapshot_hash),
    binding.accounting_task_count,
    taskSummary.accountingReceiptCount,
  )
  const reconciliation = validateReconciliation(await loadLatestReconciliation(env, binding))

  const reasons: string[] = [...taskSummary.haltReasons, ...dispatch.haltReasons, ...reconciliation.haltReasons]
  let status: BitgetAttestedRecoveryReadinessStatus
  if (reasons.length > 0) {
    status = 'HALT_FOR_REVIEW'
  } else if (taskSummary.accountingReceiptCount < binding.accounting_task_count) {
    status = 'PENDING_ACCOUNTING_REVIEW'
    reasons.push('accounting_review_required')
  } else if (taskSummary.settlementReceiptCount < taskSummary.reservationRequiredCount) {
    status = 'PENDING_SETTLEMENT'
    reasons.push('reservation_settlement_evidence_missing')
  } else {
    const requiredAfter = maximumTimestamp([
      binding.linked_at,
      dispatch.occurredAt,
      taskSummary.latestAccountedAt,
      taskSummary.latestSettledAt,
    ])
    const reconciliationFresh = reconciliation.observedAt !== null
      && requiredAfter !== null
      && timestamp(reconciliation.observedAt, 'reconciliationObservedAt').milliseconds
        >= timestamp(requiredAfter, 'requiredReconciliationAfter').milliseconds
    if (!reconciliationFresh) {
      status = 'PENDING_RECONCILIATION'
      reasons.push('reconciliation_evidence_missing_or_stale')
    } else if (reconciliation.status === 'HALT_FOR_REVIEW') {
      status = 'HALT_FOR_REVIEW'
    } else {
      status = 'CLEAR'
    }
  }

  const oldestEvidenceAt = taskSummary.oldestTaskAt ?? timestamp(binding.linked_at, 'linkedAt').iso
  const stale = status !== 'CLEAR'
    && evaluated.milliseconds - timestamp(oldestEvidenceAt, 'oldestEvidenceAt').milliseconds > STALE_AFTER_MS
  if (stale) reasons.push('attested_recovery_backlog_stale')
  const normalizedReasons = uniqueSorted(reasons)
  const incidentRequired = status === 'HALT_FOR_REVIEW' || stale
  const operatorReviewRequired = status !== 'CLEAR'
  const reconciliationStatus = reconciliation.status

  const checkpointEvidence = {
    checkpointId,
    bindingId,
    bindingHash: binding.binding_hash,
    attestationId: binding.attestation_id,
    ingestionId: binding.ingestion_id,
    exchangeAccountId: binding.exchange_account_id,
    productId: binding.product_id,
    sourceMode: binding.source_mode,
    externalReadOnlyEvidence: binding.external_read_only_evidence === 1,
    status,
    reasons: normalizedReasons,
    accountingTaskCount: binding.accounting_task_count,
    accountingReceiptCount: taskSummary.accountingReceiptCount,
    reservationRequiredCount: taskSummary.reservationRequiredCount,
    settlementReceiptCount: taskSummary.settlementReceiptCount,
    dispatchStatus: dispatch.status,
    reconciliationStatus,
    latestAccountedAt: taskSummary.latestAccountedAt,
    latestSettledAt: taskSummary.latestSettledAt,
    latestReconciledAt: reconciliation.observedAt,
    oldestTaskAt: taskSummary.oldestTaskAt,
    evaluatedAt: evaluated.iso,
    incidentRequired,
    operatorReviewRequired,
    automaticAccountingDispatchAllowed: false as const,
    automaticReservationSettlementAllowed: false as const,
    automaticReconciliationAllowed: false as const,
    certificationCheckProjectionAllowed: false as const,
    certifiedForLive: false as const,
    providerMutationAllowed: false as const,
    automaticRetryAllowed: false as const,
    transferAllowed: false as const,
    withdrawalAllowed: false as const,
    executionAllowed: false as const,
    credentialsPersisted: false as const,
  }
  const checkpointHash = await canonicalHash(checkpointEvidence)
  const evidence = Object.freeze({ ...checkpointEvidence, checkpointHash })

  const existing = await loadCheckpoint(env, checkpointId, bindingId, evaluated.iso)
  if (existing) {
    assertCheckpointCompatible(existing, evidence)
    return Object.freeze({ persistenceStatus: 'REPLAYED', ...evidence })
  }

  const statements = [
    env.DB.prepare(`
      INSERT INTO live_bitget_attested_recovery_readiness (
        checkpoint_id, binding_id, binding_hash, attestation_id, ingestion_id,
        exchange_account_id, product_id, source_mode,
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
        provider_mutation_allowed, automatic_retry_allowed, transfer_allowed,
        withdrawal_allowed, execution_allowed, credentials_persisted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    `).bind(
      checkpointId,
      bindingId,
      binding.binding_hash,
      binding.attestation_id,
      binding.ingestion_id,
      binding.exchange_account_id,
      binding.product_id,
      binding.source_mode,
      binding.external_read_only_evidence,
      status,
      canonicalJson(normalizedReasons),
      binding.accounting_task_count,
      taskSummary.accountingReceiptCount,
      taskSummary.reservationRequiredCount,
      taskSummary.settlementReceiptCount,
      dispatch.status,
      reconciliationStatus,
      taskSummary.latestAccountedAt,
      taskSummary.latestSettledAt,
      reconciliation.observedAt,
      taskSummary.oldestTaskAt,
      evaluated.iso,
      checkpointHash,
      incidentRequired ? 1 : 0,
      operatorReviewRequired ? 1 : 0,
    ),
    env.DB.prepare(`
      INSERT INTO live_bitget_attested_recovery_readiness_events (
        checkpoint_event_id, checkpoint_id, binding_id, event_type,
        status, checkpoint_hash, incident_required, occurred_at
      ) VALUES (?, ?, ?, 'ATTESTED_RECOVERY_READINESS_EVALUATED', ?, ?, ?, ?)
    `).bind(
      `attested-recovery-readiness-event:${checkpointHash.slice(0, 32)}`,
      checkpointId,
      bindingId,
      status,
      checkpointHash,
      incidentRequired ? 1 : 0,
      evaluated.iso,
    ),
  ]

  try {
    await env.DB.batch(statements)
  } catch (error) {
    const raced = await loadCheckpoint(env, checkpointId, bindingId, evaluated.iso)
    if (!raced) throw error
    assertCheckpointCompatible(raced, evidence)
    return Object.freeze({ persistenceStatus: 'REPLAYED', ...evidence })
  }

  const projected = await loadCheckpoint(env, checkpointId, bindingId, evaluated.iso)
  if (!projected) throw new Error('attested recovery readiness checkpoint is missing after D1 batch')
  assertCheckpointCompatible(projected, evidence)
  return Object.freeze({ persistenceStatus: 'PROJECTED', ...evidence })
}
