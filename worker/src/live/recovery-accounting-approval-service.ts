import {
  evaluateRecoveryAccountingApproval,
  type RecoveryAccountingApprovalDecision,
  type RecoveryAccountingApprovalInput,
} from './recovery-accounting-approval.ts'
import { assertBitgetRecoveryAccountingPlanIntegrity } from './recovery-accounting-plan-integrity.ts'

export interface VerifiedRecoveryAccountingApprovalDecision
  extends RecoveryAccountingApprovalDecision {
  planIntegrityVerified: true
}

export async function evaluateVerifiedRecoveryAccountingApproval(
  input: RecoveryAccountingApprovalInput,
): Promise<VerifiedRecoveryAccountingApprovalDecision> {
  await assertBitgetRecoveryAccountingPlanIntegrity(input.plan)
  const decision = await evaluateRecoveryAccountingApproval(input)
  return Object.freeze({
    ...decision,
    planIntegrityVerified: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}
