import {
  executeApprovedRecoveryAccountingPackage,
  loadApprovedRecoveryAccountingPackage,
  RecoveryAccountingDispatchNotApprovedError,
  type ApprovedRecoveryAccountingPackage,
  type RecoveryAccountingDispatchExecutor,
  type RecoveryAccountingDispatchResult,
} from './recovery-accounting-dispatch.ts'
import type { RecoveryAccountingApprovalStoreEnv } from './recovery-accounting-approval-store.ts'

const VERIFIED_APPROVAL_PACKAGE = Symbol('verified-recovery-accounting-approval-package')

export interface VerifiedApprovedRecoveryAccountingPackage
  extends ApprovedRecoveryAccountingPackage {
  readonly [VERIFIED_APPROVAL_PACKAGE]: true
}

export async function loadVerifiedApprovedRecoveryAccountingPackage(
  env: RecoveryAccountingApprovalStoreEnv,
  planId: string,
  approvalEventId: string,
): Promise<VerifiedApprovedRecoveryAccountingPackage> {
  const approvedPackage = await loadApprovedRecoveryAccountingPackage(
    env,
    planId,
    approvalEventId,
  )
  return Object.freeze({
    ...approvedPackage,
    [VERIFIED_APPROVAL_PACKAGE]: true,
    operatorApproved: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export async function executeVerifiedRecoveryAccountingPackage(
  dispatchId: string,
  approvedPackage: VerifiedApprovedRecoveryAccountingPackage,
  executor: RecoveryAccountingDispatchExecutor,
): Promise<RecoveryAccountingDispatchResult> {
  if (approvedPackage[VERIFIED_APPROVAL_PACKAGE] !== true) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting package was not loaded from immutable approval evidence',
    )
  }
  return executeApprovedRecoveryAccountingPackage(
    dispatchId,
    approvedPackage,
    executor,
  )
}
