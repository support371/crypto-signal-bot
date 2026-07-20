import { canonicalHash } from './canonical-json.ts'
import type { RecoveryAccountingApprovalStoreEnv } from './recovery-accounting-approval-store.ts'
import type {
  RecoveryAccountingCommandReceipt,
  RecoveryAccountingDispatchResult,
} from './recovery-accounting-dispatch.ts'
import type { VerifiedApprovedRecoveryAccountingPackage } from './recovery-accounting-dispatch-service.ts'

export interface RecoveryAccountingDispatchStoreEnv
  extends RecoveryAccountingApprovalStoreEnv {}

export interface PersistRecoveryAccountingDispatchResult {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  dispatchId: string
  dispatchHash: string
  status: RecoveryAccountingDispatchResult['status']
  commandCount: number
  completedCommandCount: number
  operatorApproved: true
  automaticallyDispatched: false
  automaticallyRetried: false
  requiresAccountCoordinatorSerialization: true
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export class RecoveryAccountingDispatchStoreConflictError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_DISPATCH_STORE_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingDispatchStoreConflictError'
  }
}

type DispatchRow = {
  dispatch_id: string
  plan_id: string
  approval_event_id: string
  plan_hash: string
  status: 'COMPLETED' | 'PARTIAL' | 'FAILED'
  command_count: number
  completed_command_count: number
  failed_command_index: number | null
  failed_fill_id: string | null
  failure_code: string | null
  dispatch_hash: string
  operator_approved: number
  automatically_dispatched: number
  automatically_retried: number
  requires_coordinator_serialization: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
  occurred_at: string
}

type ReceiptRow = {
  command_index: number
  fill_id: string
  result_status: 'PROJECTED' | 'REPLAYED'
  accounting_receipt_id: string
  journal_id: string
  accounting_hash: string
  position_quantity: string
  cumulative_realized_pnl_quote: string
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function assertResultCapabilities(result: RecoveryAccountingDispatchResult): void {
  if (
    result.operatorApproved !== true
    || result.automaticallyDispatched !== false
    || result.automaticallyRetried !== false
    || result.requiresAccountCoordinatorSerialization !== true
    || result.providerMutationAllowed !== false
    || result.reservationApplied !== false
    || result.executionAllowed !== false
  ) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'recovery accounting dispatch violates the permanent capability locks',
    )
  }
}

function assertRowCapabilities(row: DispatchRow): void {
  if (
    row.operator_approved !== 1
    || row.automatically_dispatched !== 0
    || row.automatically_retried !== 0
    || row.requires_coordinator_serialization !== 1
    || row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'stored recovery accounting dispatch violates the permanent capability locks',
    )
  }
}

function assertReceiptCapabilities(row: ReceiptRow): void {
  if (
    row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'stored recovery accounting command receipt violates capability locks',
    )
  }
}

function assertStatusConsistency(result: RecoveryAccountingDispatchResult): void {
  if (result.commandCount < 0 || result.completedCommandCount < 0) {
    throw new RangeError('dispatch command counts must be non-negative')
  }
  if (
    result.commandCount !== result.receipts.length
      + (result.failedCommandIndex === null ? 0 : 1)
      + Math.max(0, result.commandCount - result.completedCommandCount - (result.failedCommandIndex === null ? 0 : 1))
  ) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'dispatch command accounting is inconsistent',
    )
  }
  if (result.completedCommandCount !== result.receipts.length) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'completed command count does not match receipts',
    )
  }
  if (result.status === 'COMPLETED') {
    if (
      result.completedCommandCount !== result.commandCount
      || result.failedCommandIndex !== null
      || result.failedFillId !== null
      || result.failureCode !== null
    ) {
      throw new RecoveryAccountingDispatchStoreConflictError(
        'completed dispatch contains failure evidence',
      )
    }
  } else {
    if (
      result.failedCommandIndex !== result.completedCommandCount
      || result.failedCommandIndex === null
      || result.failedFillId === null
      || result.failureCode === null
    ) {
      throw new RecoveryAccountingDispatchStoreConflictError(
        'failed or partial dispatch lacks terminal failure evidence',
      )
    }
    if (result.status === 'FAILED' && result.completedCommandCount !== 0) {
      throw new RecoveryAccountingDispatchStoreConflictError(
        'failed dispatch cannot contain completed command receipts',
      )
    }
    if (
      result.status === 'PARTIAL'
      && (result.completedCommandCount <= 0 || result.completedCommandCount >= result.commandCount)
    ) {
      throw new RecoveryAccountingDispatchStoreConflictError(
        'partial dispatch must complete some but not all commands',
      )
    }
  }
}

function assertReceiptsMatchPlan(
  approvedPackage: VerifiedApprovedRecoveryAccountingPackage,
  result: RecoveryAccountingDispatchResult,
): void {
  const seenFillIds = new Set<string>()
  for (let index = 0; index < result.receipts.length; index += 1) {
    const receipt = result.receipts[index]
    const command = approvedPackage.plan.commands[index]
    if (
      receipt.commandIndex !== index
      || !command
      || receipt.fillId !== command.fill.fillId
      || seenFillIds.has(receipt.fillId)
    ) {
      throw new RecoveryAccountingDispatchStoreConflictError(
        'dispatch command receipts do not match the approved plan order',
      )
    }
    seenFillIds.add(receipt.fillId)
    sha256(receipt.accountingHash, `receipt ${index} accountingHash`)
    required(receipt.accountingReceiptId, `receipt ${index} accountingReceiptId`)
    required(receipt.journalId, `receipt ${index} journalId`)
  }
  if (
    result.failedCommandIndex !== null
    && approvedPackage.plan.commands[result.failedCommandIndex]?.fill.fillId
      !== result.failedFillId
  ) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'failed fill does not match the approved plan command',
    )
  }
}

async function expectedDispatchHash(
  result: RecoveryAccountingDispatchResult,
): Promise<string> {
  return canonicalHash({
    dispatchId: result.dispatchId,
    planId: result.planId,
    approvalEventId: result.approvalEventId,
    planHash: result.planHash,
    status: result.status,
    commandCount: result.commandCount,
    completedCommandCount: result.completedCommandCount,
    receipts: result.receipts,
    failedCommandIndex: result.failedCommandIndex,
    failedFillId: result.failedFillId,
    failureCode: result.failureCode,
    operatorApproved: true,
    automaticallyDispatched: false,
    automaticallyRetried: false,
    requiresAccountCoordinatorSerialization: true,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

async function loadDispatch(
  env: RecoveryAccountingDispatchStoreEnv,
  dispatchId: string,
  dispatchHash: string,
): Promise<DispatchRow | null> {
  return env.DB.prepare(`
    SELECT dispatch_id, plan_id, approval_event_id, plan_hash, status,
           command_count, completed_command_count, failed_command_index,
           failed_fill_id, failure_code, dispatch_hash, operator_approved,
           automatically_dispatched, automatically_retried,
           requires_coordinator_serialization, provider_mutation_allowed,
           reservation_applied, execution_allowed, occurred_at
      FROM live_recovery_accounting_dispatches
     WHERE dispatch_id = ? OR dispatch_hash = ?
     LIMIT 1
  `).bind(dispatchId, dispatchHash).first<DispatchRow>()
}

async function loadReceipts(
  env: RecoveryAccountingDispatchStoreEnv,
  dispatchId: string,
): Promise<readonly ReceiptRow[]> {
  const rows = await env.DB.prepare(`
    SELECT command_index, fill_id, result_status, accounting_receipt_id,
           journal_id, accounting_hash, position_quantity,
           cumulative_realized_pnl_quote, provider_mutation_allowed,
           reservation_applied, execution_allowed
      FROM live_recovery_accounting_dispatch_receipts
     WHERE dispatch_id = ?
     ORDER BY command_index ASC
  `).bind(dispatchId).all<ReceiptRow>()
  return Object.freeze(rows.results)
}

function assertStoredEvidence(
  row: DispatchRow,
  receipts: readonly ReceiptRow[],
  result: RecoveryAccountingDispatchResult,
  occurredAt: string,
): void {
  assertRowCapabilities(row)
  if (
    row.dispatch_id !== result.dispatchId
    || row.plan_id !== result.planId
    || row.approval_event_id !== result.approvalEventId
    || row.plan_hash !== result.planHash
    || row.status !== result.status
    || row.command_count !== result.commandCount
    || row.completed_command_count !== result.completedCommandCount
    || row.failed_command_index !== result.failedCommandIndex
    || row.failed_fill_id !== result.failedFillId
    || row.failure_code !== result.failureCode
    || row.dispatch_hash !== result.dispatchHash
    || row.occurred_at !== occurredAt
    || receipts.length !== result.receipts.length
  ) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'stored recovery accounting dispatch conflicts with result evidence',
    )
  }
  for (let index = 0; index < receipts.length; index += 1) {
    const rowReceipt = receipts[index]
    const resultReceipt = result.receipts[index]
    assertReceiptCapabilities(rowReceipt)
    if (
      rowReceipt.command_index !== resultReceipt.commandIndex
      || rowReceipt.fill_id !== resultReceipt.fillId
      || rowReceipt.result_status !== resultReceipt.status
      || rowReceipt.accounting_receipt_id !== resultReceipt.accountingReceiptId
      || rowReceipt.journal_id !== resultReceipt.journalId
      || rowReceipt.accounting_hash !== resultReceipt.accountingHash
      || rowReceipt.position_quantity !== resultReceipt.positionQuantity
      || rowReceipt.cumulative_realized_pnl_quote
        !== resultReceipt.cumulativeRealizedPnlQuote
    ) {
      throw new RecoveryAccountingDispatchStoreConflictError(
        `stored recovery accounting receipt ${index} conflicts with result evidence`,
      )
    }
  }
}

function projectedResult(
  projectionStatus: PersistRecoveryAccountingDispatchResult['projectionStatus'],
  result: RecoveryAccountingDispatchResult,
): PersistRecoveryAccountingDispatchResult {
  return Object.freeze({
    projectionStatus,
    dispatchId: result.dispatchId,
    dispatchHash: result.dispatchHash,
    status: result.status,
    commandCount: result.commandCount,
    completedCommandCount: result.completedCommandCount,
    operatorApproved: true,
    automaticallyDispatched: false,
    automaticallyRetried: false,
    requiresAccountCoordinatorSerialization: true,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export async function persistRecoveryAccountingDispatchResult(
  env: RecoveryAccountingDispatchStoreEnv,
  approvedPackage: VerifiedApprovedRecoveryAccountingPackage,
  result: RecoveryAccountingDispatchResult,
  occurredAt: string,
): Promise<PersistRecoveryAccountingDispatchResult> {
  const normalizedOccurredAt = iso(occurredAt, 'occurredAt')
  assertResultCapabilities(result)
  assertStatusConsistency(result)
  assertReceiptsMatchPlan(approvedPackage, result)
  if (
    result.planId !== approvedPackage.planId
    || result.approvalEventId !== approvedPackage.approvalEventId
    || result.planHash !== approvedPackage.plan.planHash
    || result.commandCount !== approvedPackage.plan.commandCount
  ) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'dispatch result does not match the verified approved package',
    )
  }
  const recomputedHash = await expectedDispatchHash(result)
  if (recomputedHash !== sha256(result.dispatchHash, 'dispatchHash')) {
    throw new RecoveryAccountingDispatchStoreConflictError(
      'dispatch hash does not match its command receipts',
    )
  }

  const existing = await loadDispatch(env, result.dispatchId, result.dispatchHash)
  if (existing) {
    const existingReceipts = await loadReceipts(env, existing.dispatch_id)
    assertStoredEvidence(existing, existingReceipts, result, normalizedOccurredAt)
    return projectedResult('REPLAYED', result)
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO live_recovery_accounting_dispatches (
        dispatch_id, plan_id, approval_event_id, plan_hash, status,
        command_count, completed_command_count, failed_command_index,
        failed_fill_id, failure_code, dispatch_hash, operator_approved,
        automatically_dispatched, automatically_retried,
        requires_coordinator_serialization, provider_mutation_allowed,
        reservation_applied, execution_allowed, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 1, 0, 0, 0, ?)
    `).bind(
      result.dispatchId,
      result.planId,
      result.approvalEventId,
      result.planHash,
      result.status,
      result.commandCount,
      result.completedCommandCount,
      result.failedCommandIndex,
      result.failedFillId,
      result.failureCode,
      result.dispatchHash,
      normalizedOccurredAt,
    ),
    ...result.receipts.map((receipt: RecoveryAccountingCommandReceipt) => (
      env.DB.prepare(`
        INSERT INTO live_recovery_accounting_dispatch_receipts (
          dispatch_id, command_index, fill_id, result_status,
          accounting_receipt_id, journal_id, accounting_hash,
          position_quantity, cumulative_realized_pnl_quote,
          provider_mutation_allowed, reservation_applied, execution_allowed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)
      `).bind(
        result.dispatchId,
        receipt.commandIndex,
        receipt.fillId,
        receipt.status,
        receipt.accountingReceiptId,
        receipt.journalId,
        receipt.accountingHash,
        receipt.positionQuantity,
        receipt.cumulativeRealizedPnlQuote,
      )
    )),
  ]
  await env.DB.batch(statements)

  const projected = await loadDispatch(env, result.dispatchId, result.dispatchHash)
  if (!projected) {
    throw new Error('recovery accounting dispatch evidence is missing after D1 batch')
  }
  const projectedReceipts = await loadReceipts(env, result.dispatchId)
  assertStoredEvidence(projected, projectedReceipts, result, normalizedOccurredAt)
  return projectedResult('PROJECTED', result)
}
