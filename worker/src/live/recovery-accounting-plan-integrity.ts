import { canonicalHash } from './canonical-json.ts'
import type { BitgetRecoveryAccountingPlan } from './bitget-recovery-accounting-plan.ts'

export class RecoveryAccountingPlanIntegrityError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_PLAN_INTEGRITY_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingPlanIntegrityError'
  }
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new RecoveryAccountingPlanIntegrityError(
      `${field} must be a lowercase SHA-256 hash`,
    )
  }
  return normalized
}

export async function calculateBitgetRecoveryAccountingPlanHash(
  plan: Omit<BitgetRecoveryAccountingPlan, 'planHash'>,
): Promise<string> {
  return canonicalHash({
    exchangeName: plan.exchangeName,
    exchangeAccountId: plan.exchangeAccountId,
    productId: plan.productId,
    recoverySnapshotHash: plan.recoverySnapshotHash,
    commands: plan.commands,
    accountingEvidenceReady: plan.accountingEvidenceReady,
    automaticallyDispatched: plan.automaticallyDispatched,
    providerMutationAllowed: plan.providerMutationAllowed,
    reservationApplied: plan.reservationApplied,
    executionAllowed: plan.executionAllowed,
  })
}

export async function assertBitgetRecoveryAccountingPlanIntegrity(
  plan: BitgetRecoveryAccountingPlan,
): Promise<string> {
  if (
    plan.exchangeName !== 'BITGET'
    || plan.accountingEvidenceReady !== true
    || plan.automaticallyDispatched !== false
    || plan.providerMutationAllowed !== false
    || plan.reservationApplied !== false
    || plan.executionAllowed !== false
  ) {
    throw new RecoveryAccountingPlanIntegrityError(
      'recovery accounting plan violates the permanent capability boundary',
    )
  }
  if (plan.commandCount !== plan.commands.length) {
    throw new RecoveryAccountingPlanIntegrityError(
      'recovery accounting plan command count is inconsistent',
    )
  }
  sha256(plan.recoverySnapshotHash, 'recoverySnapshotHash')
  const suppliedPlanHash = sha256(plan.planHash, 'planHash')
  const { planHash: _ignored, ...hashablePlan } = plan
  const expectedPlanHash = await calculateBitgetRecoveryAccountingPlanHash(hashablePlan)
  if (expectedPlanHash !== suppliedPlanHash) {
    throw new RecoveryAccountingPlanIntegrityError(
      'recovery accounting plan hash does not match its commands',
    )
  }

  for (const command of plan.commands) {
    if (
      command.exchangeName !== 'BITGET'
      || command.exchangeAccountId !== plan.exchangeAccountId
      || command.fill.productId !== plan.productId
      || !/^[a-f0-9]{64}$/.test(command.rawResponseHash)
    ) {
      throw new RecoveryAccountingPlanIntegrityError(
        'recovery accounting command does not match the plan scope',
      )
    }
  }
  return expectedPlanHash
}
