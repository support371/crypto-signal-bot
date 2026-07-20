import { canonicalHash } from '../../canonical-json.ts'
import {
  BITGET_DEMO_WRITE_CONTRACT,
  type BitgetDemoRateLimitAuthority,
  type BitgetDemoRateLimitClaim,
  type BitgetDemoRateLimitClaimInput,
} from './demo-write-transport.ts'
import {
  BITGET_MUTATION_EVIDENCE_ENDPOINTS,
  type BitgetCandidateOperation,
} from './execution-candidate.ts'

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const WINDOW_STATE_PREFIX = 'bitget-demo-rate-window:'
const RECEIPT_PREFIX = 'bitget-demo-rate-receipt:'
const DEFAULT_MAX_CLOCK_SKEW_MS = 1_000

interface StoredSlidingWindowStateBase {
  schemaVersion: 1
  exchangeAccountId: string
  operation: BitgetCandidateOperation
  requestTimestampsMs: readonly number[]
  updatedAtMs: number
  providerMutationAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

interface StoredSlidingWindowState extends StoredSlidingWindowStateBase {
  stateHash: string
}

export interface BitgetDemoDurableRateLimitReceiptBase extends BitgetDemoRateLimitClaim {
  schemaVersion: 1
  receiptId: string
  endpoint: string
  requestedAtMs: number
  observedCountBefore: number
  observedCountAfter: number
  remainingRequests: number
  providerMutationAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

type StoredRateLimitReceipt = BitgetDemoDurableRateLimitReceiptBase

export interface BitgetDemoDurableRateLimitReceipt extends BitgetDemoDurableRateLimitReceiptBase {
  replayed: boolean
}

export interface BitgetDemoDurableRateLimitAuthorityOptions {
  storage: DurableObjectStorage
  exchangeAccountId: string
  now?: () => number
  maxClockSkewMs?: number
}

export class BitgetDemoRateLimitAuthorityError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetDemoRateLimitAuthorityError'
    this.code = code
  }
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoRateLimitAuthorityError('RATE_LIMIT_INPUT_INVALID', `${field} is invalid`)
  }
  return normalized
}

function requiredHash(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    throw new BitgetDemoRateLimitAuthorityError('RATE_LIMIT_INPUT_INVALID', `${field} must be a SHA-256 digest`)
  }
  return normalized
}

function expectedEndpoint(operation: BitgetCandidateOperation): string {
  if (operation === 'PLACE') return BITGET_MUTATION_EVIDENCE_ENDPOINTS.placeOrder
  if (operation === 'CANCEL') return BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelOrder
  return BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelReplaceOrder
}

function expectedMaximum(operation: BitgetCandidateOperation): number {
  return BITGET_DEMO_WRITE_CONTRACT.requestLimitsPerSecond[operation]
}

function assertOperation(value: unknown): asserts value is BitgetCandidateOperation {
  if (value !== 'PLACE' && value !== 'CANCEL' && value !== 'CANCEL_REPLACE') {
    throw new BitgetDemoRateLimitAuthorityError('RATE_LIMIT_INPUT_INVALID', 'operation is invalid')
  }
}

function assertTrustedClock(value: number): void {
  if (!Number.isSafeInteger(value) || !/^\d{13}$/.test(String(value))) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_CLOCK_INVALID',
      'Durable rate-limit clock must return Unix milliseconds',
    )
  }
}

function validateClaimInput(
  accountId: string,
  input: Readonly<BitgetDemoRateLimitClaimInput>,
  trustedNowMs: number,
  maxClockSkewMs: number,
): Readonly<BitgetDemoRateLimitClaimInput> {
  assertOperation(input.operation)
  const normalized = Object.freeze({
    exchangeAccountId: requiredIdentifier(input.exchangeAccountId, 'exchangeAccountId'),
    dispatchAttemptId: requiredIdentifier(input.dispatchAttemptId, 'dispatchAttemptId'),
    candidateHash: requiredHash(input.candidateHash, 'candidateHash'),
    operation: input.operation,
    endpoint: String(input.endpoint ?? '').trim(),
    requestedAtMs: input.requestedAtMs,
    windowMs: input.windowMs,
    maximumRequests: input.maximumRequests,
  })
  if (normalized.exchangeAccountId !== accountId) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_ACCOUNT_MISMATCH',
      'Rate-limit claim does not belong to this exchange-account Durable Object',
    )
  }
  if (
    normalized.endpoint !== expectedEndpoint(normalized.operation)
    || normalized.windowMs !== 1000
    || normalized.maximumRequests !== expectedMaximum(normalized.operation)
  ) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_CONTRACT_MISMATCH',
      'Rate-limit claim does not match the reviewed Bitget endpoint contract',
    )
  }
  if (
    !Number.isSafeInteger(normalized.requestedAtMs)
    || Math.abs(normalized.requestedAtMs - trustedNowMs) > maxClockSkewMs
  ) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_REQUEST_TIME_INVALID',
      'Rate-limit request time is outside the trusted-clock tolerance',
    )
  }
  return normalized
}

function stateKey(operation: BitgetCandidateOperation): string {
  return `${WINDOW_STATE_PREFIX}${operation}`
}

function receiptKey(dispatchAttemptId: string): string {
  return `${RECEIPT_PREFIX}${dispatchAttemptId}`
}

function receiptId(dispatchAttemptId: string): string {
  return `bitget-demo-rate:${dispatchAttemptId}`
}

function validateTimestamps(value: unknown, trustedNowMs: number): readonly number[] {
  if (!Array.isArray(value) || value.length > 10) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_STATE_CORRUPT',
      'Stored sliding-window timestamps are malformed',
    )
  }
  const timestamps = value.map((timestamp) => Number(timestamp))
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = timestamps[index]!
    if (
      !Number.isSafeInteger(timestamp)
      || timestamp > trustedNowMs
      || (index > 0 && timestamp < timestamps[index - 1]!)
    ) {
      throw new BitgetDemoRateLimitAuthorityError(
        'RATE_LIMIT_STATE_CORRUPT',
        'Stored sliding-window timestamps are invalid or unordered',
      )
    }
  }
  return Object.freeze(timestamps)
}

async function verifyStoredState(
  state: StoredSlidingWindowState,
  accountId: string,
  operation: BitgetCandidateOperation,
  trustedNowMs: number,
): Promise<readonly number[]> {
  const { stateHash, ...base } = state
  if (
    state.schemaVersion !== 1
    || state.exchangeAccountId !== accountId
    || state.operation !== operation
    || state.providerMutationAllowed !== false
    || state.liveExecutionAllowed !== false
    || state.realFundsAllowed !== false
    || state.mainnetAllowed !== false
    || state.withdrawalsAllowed !== false
    || state.automaticRetryAllowed !== false
    || !Number.isSafeInteger(state.updatedAtMs)
    || !SHA256_PATTERN.test(String(stateHash ?? ''))
    || await canonicalHash(base) !== stateHash
  ) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_STATE_CORRUPT',
      'Stored rate-limit state failed integrity or capability verification',
    )
  }
  const timestamps = validateTimestamps(state.requestTimestampsMs, trustedNowMs)
  if (timestamps.length > expectedMaximum(operation)) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_STATE_CORRUPT',
      'Stored sliding-window count exceeds the reviewed endpoint ceiling',
    )
  }
  return timestamps
}

async function buildStoredState(input: {
  exchangeAccountId: string
  operation: BitgetCandidateOperation
  requestTimestampsMs: readonly number[]
  updatedAtMs: number
}): Promise<StoredSlidingWindowState> {
  const base = Object.freeze({
    schemaVersion: 1 as const,
    exchangeAccountId: input.exchangeAccountId,
    operation: input.operation,
    requestTimestampsMs: Object.freeze([...input.requestTimestampsMs]),
    updatedAtMs: input.updatedAtMs,
    providerMutationAllowed: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
  return Object.freeze({ ...base, stateHash: await canonicalHash(base) })
}

async function verifyStoredReceipt(
  receipt: StoredRateLimitReceipt,
  input: Readonly<BitgetDemoRateLimitClaimInput>,
): Promise<StoredRateLimitReceipt> {
  const { receiptHash, ...base } = receipt
  if (
    receipt.schemaVersion !== 1
    || receipt.receiptId !== receiptId(input.dispatchAttemptId)
    || receipt.exchangeAccountId !== input.exchangeAccountId
    || receipt.dispatchAttemptId !== input.dispatchAttemptId
    || receipt.candidateHash !== input.candidateHash
    || receipt.operation !== input.operation
    || receipt.endpoint !== input.endpoint
    || receipt.requestedAtMs !== input.requestedAtMs
    || receipt.windowMs !== input.windowMs
    || receipt.maximumRequests !== input.maximumRequests
    || typeof receipt.allowed !== 'boolean'
    || !Number.isSafeInteger(receipt.claimedAtMs)
    || !Number.isSafeInteger(receipt.observedCountBefore)
    || !Number.isSafeInteger(receipt.observedCountAfter)
    || !Number.isSafeInteger(receipt.remainingRequests)
    || receipt.observedCountBefore < 0
    || receipt.observedCountAfter < receipt.observedCountBefore
    || receipt.observedCountAfter > receipt.maximumRequests
    || (receipt.allowed && receipt.observedCountAfter !== receipt.observedCountBefore + 1)
    || (!receipt.allowed && receipt.observedCountAfter !== receipt.observedCountBefore)
    || (!receipt.allowed && receipt.observedCountBefore !== receipt.maximumRequests)
    || receipt.remainingRequests !== receipt.maximumRequests - receipt.observedCountAfter
    || receipt.providerMutationAllowed !== false
    || receipt.liveExecutionAllowed !== false
    || receipt.realFundsAllowed !== false
    || receipt.mainnetAllowed !== false
    || receipt.withdrawalsAllowed !== false
    || receipt.automaticRetryAllowed !== false
    || !SHA256_PATTERN.test(String(receiptHash ?? ''))
    || await canonicalHash(base) !== receiptHash
  ) {
    throw new BitgetDemoRateLimitAuthorityError(
      'RATE_LIMIT_RECEIPT_CONFLICT',
      'Stored rate-limit receipt conflicts with the requested claim or safety contract',
    )
  }
  return Object.freeze({ ...base, receiptHash })
}

async function buildStoredReceipt(input: {
  claim: Readonly<BitgetDemoRateLimitClaimInput>
  claimedAtMs: number
  allowed: boolean
  observedCountBefore: number
  observedCountAfter: number
}): Promise<StoredRateLimitReceipt> {
  const base = Object.freeze({
    schemaVersion: 1 as const,
    receiptId: receiptId(input.claim.dispatchAttemptId),
    allowed: input.allowed,
    exchangeAccountId: input.claim.exchangeAccountId,
    dispatchAttemptId: input.claim.dispatchAttemptId,
    candidateHash: input.claim.candidateHash,
    operation: input.claim.operation,
    endpoint: input.claim.endpoint,
    requestedAtMs: input.claim.requestedAtMs,
    claimedAtMs: input.claimedAtMs,
    windowMs: input.claim.windowMs,
    maximumRequests: input.claim.maximumRequests,
    observedCountBefore: input.observedCountBefore,
    observedCountAfter: input.observedCountAfter,
    remainingRequests: input.claim.maximumRequests - input.observedCountAfter,
    providerMutationAllowed: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })
  return Object.freeze({ ...base, receiptHash: await canonicalHash(base) })
}

function publicReceipt(
  stored: StoredRateLimitReceipt,
  replayed: boolean,
): BitgetDemoDurableRateLimitReceipt {
  return Object.freeze({ ...stored, replayed })
}

/**
 * Durable, account-scoped demo rate limiter.
 *
 * One Durable Object instance owns one exchange-account identifier. Claims are
 * serialized in a storage transaction, use a strict sliding one-second window,
 * and persist an immutable idempotency receipt per reviewed dispatch attempt.
 * A successful rate claim is demo traffic evidence only and never authorizes a
 * provider request, live execution, real funds, mainnet, or withdrawals.
 */
export class BitgetDemoDurableRateLimitAuthority implements BitgetDemoRateLimitAuthority {
  private readonly storage: DurableObjectStorage
  private readonly exchangeAccountId: string
  private readonly now: () => number
  private readonly maxClockSkewMs: number

  constructor(options: BitgetDemoDurableRateLimitAuthorityOptions) {
    if (!options.storage || typeof options.storage.transaction !== 'function') {
      throw new BitgetDemoRateLimitAuthorityError(
        'DURABLE_STORAGE_REQUIRED',
        'Durable Object storage with transaction support is required',
      )
    }
    this.storage = options.storage
    this.exchangeAccountId = requiredIdentifier(options.exchangeAccountId, 'exchangeAccountId')
    this.now = options.now ?? Date.now
    this.maxClockSkewMs = options.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS
    if (!Number.isInteger(this.maxClockSkewMs) || this.maxClockSkewMs < 0 || this.maxClockSkewMs > 10_000) {
      throw new BitgetDemoRateLimitAuthorityError(
        'CLOCK_SKEW_INVALID',
        'maxClockSkewMs must be an integer from 0 through 10000',
      )
    }
  }

  async claim(
    input: Readonly<BitgetDemoRateLimitClaimInput>,
  ): Promise<BitgetDemoDurableRateLimitReceipt> {
    const trustedNowMs = this.now()
    assertTrustedClock(trustedNowMs)
    const claim = validateClaimInput(
      this.exchangeAccountId,
      input,
      trustedNowMs,
      this.maxClockSkewMs,
    )

    return this.storage.transaction(async (transaction) => {
      const existing = await transaction.get<StoredRateLimitReceipt>(receiptKey(claim.dispatchAttemptId))
      if (existing !== undefined) {
        return publicReceipt(await verifyStoredReceipt(existing, claim), true)
      }

      const storedState = await transaction.get<StoredSlidingWindowState>(stateKey(claim.operation))
      const timestamps = storedState === undefined
        ? Object.freeze([]) as readonly number[]
        : await verifyStoredState(storedState, this.exchangeAccountId, claim.operation, trustedNowMs)
      const cutoff = trustedNowMs - claim.windowMs
      const active = timestamps.filter((timestamp) => timestamp > cutoff)
      const allowed = active.length < claim.maximumRequests
      const nextTimestamps = allowed ? Object.freeze([...active, trustedNowMs]) : Object.freeze(active)
      const receipt = await buildStoredReceipt({
        claim,
        claimedAtMs: trustedNowMs,
        allowed,
        observedCountBefore: active.length,
        observedCountAfter: nextTimestamps.length,
      })
      const nextState = await buildStoredState({
        exchangeAccountId: this.exchangeAccountId,
        operation: claim.operation,
        requestTimestampsMs: nextTimestamps,
        updatedAtMs: trustedNowMs,
      })

      await transaction.put(stateKey(claim.operation), nextState)
      await transaction.put(receiptKey(claim.dispatchAttemptId), receipt)
      return publicReceipt(receipt, false)
    })
  }
}
