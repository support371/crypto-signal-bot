import type { DecimalString } from './decimal.ts'
import type { BitgetRestRecoveryResult } from './adapters/bitget/recovery.ts'
import {
  reconcileBitgetRecoverySnapshot,
  type BitgetRecoveryReconciliationResult,
} from './bitget-recovery-reconciliation.ts'
import type { RecoveryLookupInstruction } from './recovery-reconciliation-plan.ts'
import {
  buildBitgetRecoveryIngestionPlan,
  type BitgetRecoveryIngestionPlan,
} from './recovery-ingestion.ts'
import {
  persistAttestedBitgetRecoveryIngestion,
  type BitgetAttestedRecoveryIngestionEnv,
  type BitgetAttestedRecoveryIngestionResult,
} from './bitget-attested-recovery-ingestion.ts'

export interface BitgetRecoveryCycleInput {
  instruction: RecoveryLookupInstruction
  recovery: BitgetRestRecoveryResult
  requestedQuantity: DecimalString
  ingestionId: string
  attestationId: string
  bindingId: string
  recoveredAt: string
  linkedAt: string
}

export interface BitgetRecoveryCycleResult {
  reconciliation: BitgetRecoveryReconciliationResult
  ingestionPlan: BitgetRecoveryIngestionPlan
  persistence: BitgetAttestedRecoveryIngestionResult
  providerMutationAllowed: false
  automaticRetryAllowed: false
  executionAllowed: false
}

export interface BitgetRecoveryCycleDependencies {
  persistAttested?: typeof persistAttestedBitgetRecoveryIngestion
}

export class BitgetRecoveryCycleError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetRecoveryCycleError'
    this.code = code
  }
}

/**
 * Composes the existing recovery primitives into one evidence-preserving
 * recovery cycle after a Bitget GET-only snapshot has been obtained.
 *
 * This function deliberately does not perform the provider read itself. The
 * caller must use the existing read-only recovery client. The cycle reconciles
 * the persisted order identity, builds immutable recovery evidence, and binds
 * that evidence to an existing read-only certification attestation before D1
 * persistence. It never submits/retries/cancels an exchange order.
 */
export async function runAttestedBitgetRecoveryCycle(
  env: BitgetAttestedRecoveryIngestionEnv,
  input: BitgetRecoveryCycleInput,
  dependencies: BitgetRecoveryCycleDependencies = {},
): Promise<BitgetRecoveryCycleResult> {
  if (input.instruction.exchangeAccountId !== input.instruction.exchangeAccountId.trim()) {
    throw new BitgetRecoveryCycleError('RECOVERY_ACCOUNT_INVALID', 'exchange account ID is invalid')
  }
  if (!input.instruction.exchangeAccountId) {
    throw new BitgetRecoveryCycleError('RECOVERY_ACCOUNT_INVALID', 'exchange account ID is required')
  }

  const reconciliation = reconcileBitgetRecoverySnapshot(
    input.instruction,
    input.recovery,
    input.requestedQuantity,
  )

  const ingestionPlan = await buildBitgetRecoveryIngestionPlan({
    ingestionId: input.ingestionId,
    exchangeAccountId: input.instruction.exchangeAccountId,
    productId: input.instruction.productId,
    recoveredAt: input.recoveredAt,
    recovery: input.recovery,
  })

  if (
    ingestionPlan.snapshotHash !== reconciliation.recoverySnapshotHash
    || ingestionPlan.exchangeAccountId !== input.instruction.exchangeAccountId
    || ingestionPlan.productId !== input.instruction.productId.toUpperCase()
  ) {
    throw new BitgetRecoveryCycleError(
      'RECOVERY_EVIDENCE_MISMATCH',
      'reconciliation and ingestion evidence do not describe the same recovery scope',
    )
  }

  const persistAttested = dependencies.persistAttested ?? persistAttestedBitgetRecoveryIngestion
  const persistence = await persistAttested(env, {
    bindingId: input.bindingId,
    attestationId: input.attestationId,
    linkedAt: input.linkedAt,
    plan: ingestionPlan,
  })

  if (
    persistence.snapshotHash !== ingestionPlan.snapshotHash
    || persistence.ingestionHash !== ingestionPlan.ingestionHash
    || persistence.exchangeAccountId !== ingestionPlan.exchangeAccountId
    || persistence.productId !== ingestionPlan.productId
    || persistence.providerMutationAllowed !== false
    || persistence.automaticRetryAllowed !== false
    || persistence.executionAllowed !== false
  ) {
    throw new BitgetRecoveryCycleError(
      'RECOVERY_PERSISTENCE_MISMATCH',
      'persisted attested recovery evidence conflicts with the recovery plan',
    )
  }

  return Object.freeze({
    reconciliation,
    ingestionPlan,
    persistence,
    providerMutationAllowed: false as const,
    automaticRetryAllowed: false as const,
    executionAllowed: false as const,
  })
}
