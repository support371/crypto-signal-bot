import type { RecoveryAccountingApprovalStoreEnv } from './recovery-accounting-approval-store.ts'
import type { RecoveryAccountingDispatchResult } from './recovery-accounting-dispatch.ts'
import { loadVerifiedApprovedRecoveryAccountingPackage } from './recovery-accounting-dispatch-service.ts'
import {
  persistRecoveryAccountingDispatchResult,
  type PersistRecoveryAccountingDispatchResult,
} from './recovery-accounting-dispatch-store.ts'

export async function persistVerifiedRecoveryAccountingDispatchResult(
  env: RecoveryAccountingApprovalStoreEnv,
  planId: string,
  approvalEventId: string,
  result: RecoveryAccountingDispatchResult,
  occurredAt: string,
): Promise<PersistRecoveryAccountingDispatchResult> {
  const approvedPackage = await loadVerifiedApprovedRecoveryAccountingPackage(
    env,
    planId,
    approvalEventId,
  )
  return persistRecoveryAccountingDispatchResult(
    env,
    approvedPackage,
    result,
    occurredAt,
  )
}
