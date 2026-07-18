import type {
  BitgetDemoDispatchResult,
  VerifiedBitgetDemoDispatchAuthorization,
} from './demo-write-transport.ts'
import type { BitgetUnsignedMutationCandidate } from './execution-candidate.ts'
import {
  claimReviewedBitgetDemoDispatchAttempt,
  loadReviewedBitgetDemoDispatchAuthorization,
  persistBitgetDemoDispatchResult,
  type BitgetDemoDispatchClaim,
  type BitgetDemoDispatchEvidenceEnv,
  type BitgetDemoDispatchResultProjectionReceipt,
  type LoadedReviewedBitgetDemoAuthorization,
} from './demo-dispatch-evidence-store.ts'

export interface BitgetDemoDispatchOrchestrationInput {
  authorizationId: string
  dispatchAttemptId: string
  candidate: BitgetUnsignedMutationCandidate
}

export interface BitgetDemoAccountDispatchSerializer {
  run<T>(exchangeAccountId: string, operation: () => Promise<T>): Promise<T>
}

export interface BitgetDemoReviewedDispatchExecutor {
  serializer: BitgetDemoAccountDispatchSerializer
  dispatch(
    candidate: BitgetUnsignedMutationCandidate,
    authorization: VerifiedBitgetDemoDispatchAuthorization,
  ): Promise<BitgetDemoDispatchResult>
}

export interface BitgetDemoDispatchClock {
  now(): Date
}

export interface ReviewedBitgetDemoDispatchOutcome {
  reviewedAuthorization: LoadedReviewedBitgetDemoAuthorization
  claim: BitgetDemoDispatchClaim
  result: BitgetDemoDispatchResult
  persistence: BitgetDemoDispatchResultProjectionReceipt
}

const SYSTEM_CLOCK: BitgetDemoDispatchClock = Object.freeze({
  now: () => new Date(),
})

function clockIso(clock: BitgetDemoDispatchClock): string {
  const value = clock.now()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Bitget demo dispatch clock must return a valid Date')
  }
  return value.toISOString()
}

/**
 * Source-only reviewed demo orchestration.
 *
 * The injected executor may close over demo-only signing material in a future
 * non-public certification runner. This module never receives credentials,
 * constructs a fetch client, retries, exposes a route, or authorizes live
 * execution. The immutable one-shot claim is written before invoking the
 * executor, so a process interruption requires a new candidate and a new
 * independent review instead of replaying an uncertain attempt.
 */
export async function orchestrateReviewedBitgetDemoDispatch(
  env: BitgetDemoDispatchEvidenceEnv,
  input: BitgetDemoDispatchOrchestrationInput,
  executor: BitgetDemoReviewedDispatchExecutor,
  clock: BitgetDemoDispatchClock = SYSTEM_CLOCK,
): Promise<ReviewedBitgetDemoDispatchOutcome> {
  if (!executor.serializer || typeof executor.serializer.run !== 'function') {
    throw new TypeError('account-scoped Bitget demo serializer is required')
  }
  if (typeof executor.dispatch !== 'function') {
    throw new TypeError('reviewed Bitget demo dispatch executor is required')
  }

  const evaluatedAt = clockIso(clock)
  const reviewedAuthorization = await loadReviewedBitgetDemoDispatchAuthorization(
    env,
    input.candidate,
    input.authorizationId,
    input.dispatchAttemptId,
    evaluatedAt,
  )
  return executor.serializer.run(
    reviewedAuthorization.authorization.exchangeAccountId,
    async () => {
      const claimedAt = clockIso(clock)
      const claim = await claimReviewedBitgetDemoDispatchAttempt(
        env,
        reviewedAuthorization,
        claimedAt,
      )
      const result = await executor.dispatch(
        input.candidate,
        reviewedAuthorization.authorization,
      )
      const occurredAt = clockIso(clock)
      const persistence = await persistBitgetDemoDispatchResult(
        env,
        reviewedAuthorization,
        claim,
        input.candidate,
        result,
        occurredAt,
      )
      return Object.freeze({
        reviewedAuthorization,
        claim,
        result,
        persistence,
      })
    },
  )
}
