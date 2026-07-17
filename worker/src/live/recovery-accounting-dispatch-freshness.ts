import { canonicalHash } from './canonical-json.ts'
import type { RecoveryAccountingApprovalStoreEnv } from './recovery-accounting-approval-store.ts'
import {
  executeVerifiedRecoveryAccountingPackage,
  loadVerifiedApprovedRecoveryAccountingPackage,
  type VerifiedApprovedRecoveryAccountingPackage,
} from './recovery-accounting-dispatch-service.ts'
import {
  RecoveryAccountingDispatchNotApprovedError,
  type RecoveryAccountingDispatchExecutor,
  type RecoveryAccountingDispatchResult,
} from './recovery-accounting-dispatch.ts'

const FRESH_APPROVAL_PACKAGE = Symbol('fresh-recovery-accounting-approval-package')

export interface FreshApprovedRecoveryAccountingPackage
  extends VerifiedApprovedRecoveryAccountingPackage {
  approvalValidFrom: string
  approvalExpiresAt: string
  approvalValidityHash: string
  readonly [FRESH_APPROVAL_PACKAGE]: true
}

export class RecoveryAccountingApprovalExpiredError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_APPROVAL_EXPIRED'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingApprovalExpiredError'
  }
}

type ValidityRow = {
  approval_event_id: string
  plan_id: string
  plan_hash: string
  valid_from: string
  expires_at: string
  validity_seconds: number
  validity_hash: string
  operator_approved: number
  automatically_dispatched: number
  automatically_retried: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return parsed
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function assertValidityCapabilities(row: ValidityRow): void {
  if (
    row.operator_approved !== 1
    || row.automatically_dispatched !== 0
    || row.automatically_retried !== 0
    || row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'stored recovery accounting approval validity violates capability locks',
    )
  }
}

async function expectedValidityHash(
  approvedPackage: VerifiedApprovedRecoveryAccountingPackage,
  row: ValidityRow,
): Promise<string> {
  return canonicalHash({
    approvalEventId: approvedPackage.approvalEventId,
    planId: approvedPackage.planId,
    planHash: approvedPackage.plan.planHash,
    validFrom: row.valid_from,
    expiresAt: row.expires_at,
    validitySeconds: row.validity_seconds,
    operatorApproved: true,
    automaticallyDispatched: false,
    automaticallyRetried: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export async function loadFreshApprovedRecoveryAccountingPackage(
  env: RecoveryAccountingApprovalStoreEnv,
  planId: string,
  approvalEventId: string,
  evaluatedAt: string,
): Promise<FreshApprovedRecoveryAccountingPackage> {
  const approvedPackage = await loadVerifiedApprovedRecoveryAccountingPackage(
    env,
    planId,
    approvalEventId,
  )
  const row = await env.DB.prepare(`
    SELECT approval_event_id, plan_id, plan_hash, valid_from, expires_at,
           validity_seconds, validity_hash, operator_approved,
           automatically_dispatched, automatically_retried,
           provider_mutation_allowed, reservation_applied, execution_allowed
      FROM live_recovery_accounting_approval_validity
     WHERE approval_event_id = ?
     LIMIT 1
  `).bind(approvalEventId).first<ValidityRow>()
  if (!row) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'time-bound recovery accounting approval validity is missing',
    )
  }
  assertValidityCapabilities(row)
  if (
    row.approval_event_id !== approvedPackage.approvalEventId
    || row.plan_id !== approvedPackage.planId
    || row.plan_hash !== approvedPackage.plan.planHash
    || row.validity_seconds < 1
    || row.validity_seconds > 900
  ) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting approval validity does not match the approved plan',
    )
  }
  const validityHash = sha256(row.validity_hash, 'validityHash')
  if (await expectedValidityHash(approvedPackage, row) !== validityHash) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting approval validity hash is invalid',
    )
  }

  const nowMs = timestamp(evaluatedAt, 'evaluatedAt')
  const validFromMs = timestamp(row.valid_from, 'validFrom')
  const expiresAtMs = timestamp(row.expires_at, 'expiresAt')
  if (nowMs < validFromMs) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting approval is not valid yet',
    )
  }
  if (nowMs >= expiresAtMs) {
    throw new RecoveryAccountingApprovalExpiredError(
      'recovery accounting approval has expired',
    )
  }

  return Object.freeze({
    ...approvedPackage,
    approvalValidFrom: new Date(validFromMs).toISOString(),
    approvalExpiresAt: new Date(expiresAtMs).toISOString(),
    approvalValidityHash: validityHash,
    [FRESH_APPROVAL_PACKAGE]: true,
    operatorApproved: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export async function executeFreshApprovedRecoveryAccountingPackage(
  dispatchId: string,
  approvedPackage: FreshApprovedRecoveryAccountingPackage,
  executor: RecoveryAccountingDispatchExecutor,
): Promise<RecoveryAccountingDispatchResult> {
  if (approvedPackage[FRESH_APPROVAL_PACKAGE] !== true) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting package lacks fresh approval evidence',
    )
  }
  return executeVerifiedRecoveryAccountingPackage(
    dispatchId,
    approvedPackage,
    executor,
  )
}
