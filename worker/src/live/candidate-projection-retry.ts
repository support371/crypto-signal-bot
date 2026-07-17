export type CandidateProjectionStatus =
  | 'PENDING'
  | 'PROJECTED'
  | 'CONFLICT'
  | 'DEAD_LETTER'

export interface CandidateProjectionRetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface CandidateProjectionRetryDecision {
  nextStatus: 'PENDING' | 'CONFLICT' | 'DEAD_LETTER'
  attemptCount: number
  nextAttemptAt: string | null
  terminal: boolean
}

export const DEFAULT_CANDIDATE_PROJECTION_RETRY_POLICY: CandidateProjectionRetryPolicy = Object.freeze({
  maxAttempts: 8,
  baseDelayMs: 30_000,
  maxDelayMs: 3_600_000,
})

function validatePolicy(policy: CandidateProjectionRetryPolicy): void {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 100) {
    throw new RangeError('maxAttempts must be a safe integer from 1 to 100')
  }
  if (!Number.isSafeInteger(policy.baseDelayMs) || policy.baseDelayMs < 1_000) {
    throw new RangeError('baseDelayMs must be a safe integer of at least 1000')
  }
  if (!Number.isSafeInteger(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) {
    throw new RangeError('maxDelayMs must be a safe integer greater than or equal to baseDelayMs')
  }
}

export function projectionRetryDelayMs(
  attemptCount: number,
  policy: CandidateProjectionRetryPolicy = DEFAULT_CANDIDATE_PROJECTION_RETRY_POLICY,
): number {
  validatePolicy(policy)
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new RangeError('attemptCount must be a positive safe integer')
  }
  const exponent = Math.min(attemptCount - 1, 30)
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** exponent))
}

export function decideCandidateProjectionRetry(
  previousAttemptCount: number,
  conflict: boolean,
  now: Date,
  policy: CandidateProjectionRetryPolicy = DEFAULT_CANDIDATE_PROJECTION_RETRY_POLICY,
): CandidateProjectionRetryDecision {
  validatePolicy(policy)
  if (!Number.isSafeInteger(previousAttemptCount) || previousAttemptCount < 0) {
    throw new RangeError('previousAttemptCount must be a non-negative safe integer')
  }
  if (!Number.isFinite(now.getTime())) throw new TypeError('now must be valid')

  const attemptCount = previousAttemptCount + 1
  if (conflict) {
    return Object.freeze({
      nextStatus: 'CONFLICT',
      attemptCount,
      nextAttemptAt: null,
      terminal: true,
    })
  }
  if (attemptCount >= policy.maxAttempts) {
    return Object.freeze({
      nextStatus: 'DEAD_LETTER',
      attemptCount,
      nextAttemptAt: null,
      terminal: true,
    })
  }

  return Object.freeze({
    nextStatus: 'PENDING',
    attemptCount,
    nextAttemptAt: new Date(now.getTime() + projectionRetryDelayMs(attemptCount, policy)).toISOString(),
    terminal: false,
  })
}
