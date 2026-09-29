import type { DecimalString } from './decimal.ts'
import type { ExchangeOrderSnapshot } from './exchange-contracts.ts'
import {
  reconcileOrderObservation,
  type ReconciliationDecision,
} from './reconciliation.ts'
import type { RecoveryLookupInstruction } from './recovery-reconciliation-plan.ts'
import type { BitgetRestRecoveryResult } from './adapters/bitget/recovery.ts'

export interface BitgetRecoveryReconciliationResult {
  instruction: RecoveryLookupInstruction
  matchedOrder: ExchangeOrderSnapshot
  decision: ReconciliationDecision
  recoverySnapshotHash: string
  providerMutationAllowed: false
  automaticRetryAllowed: false
  automaticStateProjectionAllowed: false
  requiresAttestedPersistence: true
}

export class BitgetRecoveryReconciliationError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetRecoveryReconciliationError'
    this.code = code
  }
}

function matches(order: ExchangeOrderSnapshot, instruction: RecoveryLookupInstruction): boolean {
  return instruction.lookupBy === 'EXCHANGE_ORDER_ID'
    ? order.exchangeOrderId === instruction.lookupValue
    : order.clientOrderId === instruction.lookupValue
}

function rawObservation(order: ExchangeOrderSnapshot) {
  return Object.freeze({
    id: order.exchangeOrderId,
    orderId: order.exchangeOrderId,
    status: order.rawStatus,
    amount: order.requestedBaseQuantity,
    filled: order.filledBaseQuantity,
    remaining: order.remainingBaseQuantity,
    average: order.averageFillPrice,
    observedAt: order.updatedAt,
  })
}

/**
 * Reconciles one persisted recovery candidate against a completed Bitget
 * GET-only recovery snapshot. No provider request or mutation occurs here.
 *
 * The caller must obtain the snapshot through the existing read-only recovery
 * client. Missing or ambiguous identity stops the flow rather than guessing or
 * resubmitting an order.
 */
export function reconcileBitgetRecoverySnapshot(
  instruction: RecoveryLookupInstruction,
  recovery: BitgetRestRecoveryResult,
  requestedQuantity: DecimalString,
  options: {
    now?: Date
    staleAfterMs?: number
  } = {},
): BitgetRecoveryReconciliationResult {
  if (
    instruction.method !== 'GET'
    || instruction.mutationAllowed !== false
    || instruction.automaticRetryAllowed !== false
    || recovery.readOnly !== true
    || recovery.providerMutationAllowed !== false
    || recovery.executionAllowed !== false
  ) {
    throw new BitgetRecoveryReconciliationError(
      'RECOVERY_CAPABILITY_LOCK_VIOLATION',
      'recovery reconciliation requires a GET-only, mutation-locked snapshot',
    )
  }

  const candidates = recovery.snapshot.orders.filter((order) => matches(order, instruction))
  if (candidates.length === 0) {
    throw new BitgetRecoveryReconciliationError(
      'RECOVERY_ORDER_NOT_FOUND',
      'the recovery snapshot does not contain the persisted provider order identity',
    )
  }
  if (candidates.length !== 1) {
    throw new BitgetRecoveryReconciliationError(
      'RECOVERY_ORDER_AMBIGUOUS',
      'the recovery snapshot contains more than one matching provider order identity',
    )
  }

  const matchedOrder = candidates[0]!
  if (matchedOrder.productId !== instruction.productId) {
    throw new BitgetRecoveryReconciliationError(
      'RECOVERY_PRODUCT_MISMATCH',
      'the recovered provider order product does not match the persisted order',
    )
  }

  const decision = reconcileOrderObservation(
    rawObservation(matchedOrder),
    requestedQuantity,
    options,
  )

  return Object.freeze({
    instruction,
    matchedOrder,
    decision,
    recoverySnapshotHash: recovery.snapshotHash,
    providerMutationAllowed: false as const,
    automaticRetryAllowed: false as const,
    automaticStateProjectionAllowed: false as const,
    requiresAttestedPersistence: true as const,
  })
}
