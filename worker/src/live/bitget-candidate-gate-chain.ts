import {
  evaluateAuthorization,
  type AuthorizationDecision,
  type AuthorizationRequest,
} from './authorization.ts'
import {
  evaluateGuardianHierarchy,
  type EffectiveGuardianDecision,
  type GuardianScopeState,
} from './guardian.ts'
import {
  buildBitgetLockedOrderCommand,
  type BitgetLockedOrderCommand,
  type BitgetLockedOrderCommandInput,
} from './bitget-locked-order-command.ts'

export type BitgetCandidateGateChainStatus =
  | 'REJECTED_BY_AUTHORIZATION'
  | 'REJECTED_BY_GUARDIAN'
  | 'REJECTED'
  | 'READY_BUT_EXECUTION_LOCKED'

export interface BitgetCandidateGateChainInput {
  authorization: AuthorizationRequest
  guardianStates: readonly GuardianScopeState[]
  command: BitgetLockedOrderCommandInput
}

export interface BitgetCandidateGateChainOutcome {
  status: BitgetCandidateGateChainStatus
  authorization: AuthorizationDecision
  guardian: EffectiveGuardianDecision
  command: BitgetLockedOrderCommand | null
  executionAllowed: false
  providerMutationAllowed: false
  reasons: readonly string[]
}

function validateBindings(input: BitgetCandidateGateChainInput): void {
  if (input.authorization.action !== 'CREATE_ORDER') {
    throw new TypeError('candidate gate chain requires CREATE_ORDER authorization')
  }
  if (input.authorization.resourceId !== input.command.orderId) {
    throw new TypeError('authorization resourceId must match command orderId')
  }
  if (input.authorization.exchangeAccountId !== input.command.exchangeAccountId) {
    throw new TypeError('authorization exchangeAccountId must match command exchangeAccountId')
  }
}

/**
 * Source-only composition for the existing live-candidate primitives.
 *
 * This function deliberately stops before persistence, provider dispatch, or
 * accounting. It binds the authorization and Guardian decisions to the locked
 * Bitget command builder so callers cannot provide an independent
 * guardianClear=true value. The returned command remains permanently
 * execution-locked and provider-mutation-disabled.
 */
export async function evaluateBitgetCandidateGateChain(
  input: BitgetCandidateGateChainInput,
): Promise<BitgetCandidateGateChainOutcome> {
  validateBindings(input)

  const authorization = evaluateAuthorization(input.authorization)
  const guardian = evaluateGuardianHierarchy(input.guardianStates)
  const reasons = new Set<string>()

  for (const reason of authorization.reasons) reasons.add(`authorization:${reason}`)
  for (const reason of guardian.reasons) reasons.add(`guardian:${reason}`)

  if (!authorization.allowed) {
    reasons.add('authorization_denied')
    return Object.freeze({
      status: 'REJECTED_BY_AUTHORIZATION' as const,
      authorization,
      guardian,
      command: null,
      executionAllowed: false as const,
      providerMutationAllowed: false as const,
      reasons: Object.freeze(Array.from(reasons).sort()),
    })
  }

  if (!guardian.newOrdersAllowed) {
    reasons.add('guardian_new_orders_blocked')
    return Object.freeze({
      status: 'REJECTED_BY_GUARDIAN' as const,
      authorization,
      guardian,
      command: null,
      executionAllowed: false as const,
      providerMutationAllowed: false as const,
      reasons: Object.freeze(Array.from(reasons).sort()),
    })
  }

  const command = await buildBitgetLockedOrderCommand({
    ...input.command,
    risk: {
      ...input.command.risk,
      guardianClear: guardian.newOrdersAllowed,
    },
  })

  for (const reason of command.reasons) reasons.add(reason)

  return Object.freeze({
    status: command.status,
    authorization,
    guardian,
    command,
    executionAllowed: false as const,
    providerMutationAllowed: false as const,
    reasons: Object.freeze(Array.from(reasons).sort()),
  })
}
