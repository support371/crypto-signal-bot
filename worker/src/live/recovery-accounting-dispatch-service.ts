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

function assertVerifiedApprovalBrand(
  approvedPackage: VerifiedApprovedRecoveryAccountingPackage,
): void {
  if (approvedPackage[VERIFIED_APPROVAL_PACKAGE] !== true) {
    throw new RecoveryAccountingDispatchNotApprovedError(
      'recovery accounting package was not loaded from immutable approval evidence',
    )
  }
}

function defineVerifiedApprovalBrand<T extends ApprovedRecoveryAccountingPackage>(
  approvedPackage: T,
): T & VerifiedApprovedRecoveryAccountingPackage {
  Object.defineProperty(approvedPackage, VERIFIED_APPROVAL_PACKAGE, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return approvedPackage as T & VerifiedApprovedRecoveryAccountingPackage
}

/**
 * Creates a verified derived package without exposing the private verification
 * symbol. The source must already carry the immutable, non-enumerable brand.
 */
export function sealDerivedVerifiedApprovedRecoveryAccountingPackage<
  T extends ApprovedRecoveryAccountingPackage,
>(
  source: VerifiedApprovedRecoveryAccountingPackage,
  derived: T,
): T & VerifiedApprovedRecoveryAccountingPackage {
  assertVerifiedApprovalBrand(source)
  return Object.freeze(defineVerifiedApprovalBrand(derived))
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
  const verified = {
    ...approvedPackage,
    operatorApproved: true as const,
    automaticallyDispatched: false as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  return Object.freeze(defineVerifiedApprovalBrand(verified))
}

export async function executeVerifiedRecoveryAccountingPackage(
  dispatchId: string,
  approvedPackage: VerifiedApprovedRecoveryAccountingPackage,
  executor: RecoveryAccountingDispatchExecutor,
): Promise<RecoveryAccountingDispatchResult> {
  assertVerifiedApprovalBrand(approvedPackage)
  return executeApprovedRecoveryAccountingPackage(
    dispatchId,
    approvedPackage,
    executor,
  )
}
