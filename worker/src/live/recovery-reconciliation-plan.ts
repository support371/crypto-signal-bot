import type { LiveRecoveryCandidate } from './recovery-scan.ts'

export interface RecoveryLookupInstruction {
  internalOrderId: string
  exchangeAccountId: string
  productId: string
  lookupBy: 'EXCHANGE_ORDER_ID' | 'CLIENT_ORDER_ID'
  lookupValue: string
  expectedExchangeOrderId?: string | null
  expectedClientOrderId?: string | null
  method: 'GET'
  mutationAllowed: false
  automaticRetryAllowed: false
}

export interface RecoveryLookupPlan {
  status: 'LOOKUP_READY' | 'MANUAL_REVIEW_REQUIRED'
  candidate: LiveRecoveryCandidate
  instruction: RecoveryLookupInstruction | null
  providerMutationAllowed: false
  automaticRetryAllowed: false
  reason: string | null
}

function clean(value: string | null): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

/**
 * Converts a restart-recovery candidate into a provider-neutral, GET-only
 * reconciliation instruction. This never submits, cancels, replaces, or
 * retries an exchange mutation.
 *
 * Exchange order ID is authoritative when present. Client order ID is the
 * fallback for ambiguous submissions where the exchange order ID was never
 * persisted. If neither identity exists, the order must stop for manual
 * review rather than risk duplicate execution.
 */
export function planRecoveryLookup(candidate: LiveRecoveryCandidate): RecoveryLookupPlan {
  const exchangeOrderId = clean(candidate.exchangeOrderId)
  const clientOrderId = clean(candidate.clientOrderId)

  if (!exchangeOrderId && !clientOrderId) {
    return Object.freeze({
      status: 'MANUAL_REVIEW_REQUIRED' as const,
      candidate,
      instruction: null,
      providerMutationAllowed: false as const,
      automaticRetryAllowed: false as const,
      reason: 'provider_order_identity_missing',
    })
  }

  const lookupBy = exchangeOrderId ? 'EXCHANGE_ORDER_ID' as const : 'CLIENT_ORDER_ID' as const
  const lookupValue = exchangeOrderId ?? clientOrderId as string

  return Object.freeze({
    status: 'LOOKUP_READY' as const,
    candidate,
    instruction: Object.freeze({
      internalOrderId: candidate.internalOrderId,
      exchangeAccountId: candidate.exchangeAccountId,
      productId: candidate.productId,
      lookupBy,
      lookupValue,
      expectedExchangeOrderId: exchangeOrderId,
      expectedClientOrderId: clientOrderId,
      method: 'GET' as const,
      mutationAllowed: false as const,
      automaticRetryAllowed: false as const,
    }),
    providerMutationAllowed: false as const,
    automaticRetryAllowed: false as const,
    reason: null,
  })
}
