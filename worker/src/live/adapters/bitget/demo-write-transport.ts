import { canonicalHash, canonicalJson, sha256Hex } from '../../canonical-json.ts'
import { BITGET_API_ORIGIN, normalizeBitgetSymbol } from './endpoints.ts'
import {
  BITGET_MUTATION_EVIDENCE_ENDPOINTS,
  type BitgetCandidateOperation,
  type BitgetReadOnlyLookupInstruction,
  type BitgetUnsignedMutationCandidate,
} from './execution-candidate.ts'
import { signBitgetPrehash } from './read-only-client.ts'

const VERIFIED_DEMO_AUTHORIZATION = Symbol('verified-bitget-demo-authorization')
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/
const MAX_AUTHORIZATION_WINDOW_MS = 5 * 60 * 1000

export const BITGET_DEMO_WRITE_CONTRACT = Object.freeze({
  environment: 'BITGET_DEMO' as const,
  requestHeaderName: 'paptrading' as const,
  requestHeaderValue: '1' as const,
  officialContractVerifiedAt: '2026-07-18' as const,
  requestLimitsPerSecond: Object.freeze({
    PLACE: 10,
    CANCEL: 10,
    CANCEL_REPLACE: 5,
  }),
  liveExecutionAllowed: false as const,
  realFundsAllowed: false as const,
  mainnetAllowed: false as const,
  withdrawalsAllowed: false as const,
  automaticRetryAllowed: false as const,
})

export const BITGET_DEMO_PROVIDER_CODE_MANIFEST = Object.freeze({
  ambiguousRequiresLookup: Object.freeze(['40010', '40725', '45001']),
  authorizationFailure: Object.freeze([
    '40001',
    '40002',
    '40003',
    '40005',
    '40006',
    '40008',
    '40009',
    '40011',
    '40012',
    '40014',
    '40018',
    '40025',
    '40036',
    '40037',
    '40038',
    '40040',
    '40041',
  ]),
  terminalRequestFailure: Object.freeze(['40017', '40019', '40020']),
  sourceVerifiedAt: '2026-07-18' as const,
  unknownCodePolicy: 'UNKNOWN_REQUIRES_REVIEW' as const,
})

const AMBIGUOUS_CODES = new Set<string>(BITGET_DEMO_PROVIDER_CODE_MANIFEST.ambiguousRequiresLookup)
const AUTHORIZATION_CODES = new Set<string>(BITGET_DEMO_PROVIDER_CODE_MANIFEST.authorizationFailure)
const TERMINAL_CODES = new Set<string>(BITGET_DEMO_PROVIDER_CODE_MANIFEST.terminalRequestFailure)

export interface BitgetDemoSigningMaterial {
  apiKey: string
  secretKey: string
  passphrase: string
}

export interface BitgetDemoDispatchAuthorizationInput {
  authorizationId: string
  dispatchAttemptId: string
  exchangeAccountId: string
  actorId: string
  preparerId: string
  candidateHash: string
  authorizationEvidenceHash: string
  stepUpEvidenceHash: string
  riskEvidenceHash: string
  guardianEvidenceHash: string
  idempotencyEvidenceHash: string
  validFrom: string
  expiresAt: string
  environment: 'BITGET_DEMO'
  accountCoordinatorSerialized: true
  guardianClear: true
  riskApproved: true
  idempotencyClaimed: true
  demoMutationReviewed: true
  liveReleasePresent: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

export interface VerifiedBitgetDemoDispatchAuthorization
  extends Readonly<BitgetDemoDispatchAuthorizationInput> {
  toJSON(): Readonly<BitgetDemoDispatchAuthorizationInput>
}

export interface BitgetDemoRateLimitClaimInput {
  exchangeAccountId: string
  dispatchAttemptId: string
  candidateHash: string
  operation: BitgetCandidateOperation
  endpoint: string
  requestedAtMs: number
  windowMs: 1000
  maximumRequests: number
}

export interface BitgetDemoRateLimitClaim {
  allowed: boolean
  exchangeAccountId: string
  dispatchAttemptId: string
  candidateHash: string
  operation: BitgetCandidateOperation
  claimedAtMs: number
  windowMs: 1000
  maximumRequests: number
  receiptHash: string
}

export interface BitgetDemoRateLimitAuthority {
  claim(input: Readonly<BitgetDemoRateLimitClaimInput>): Promise<Readonly<BitgetDemoRateLimitClaim>>
}

export type BitgetDemoDispatchCategory =
  | 'ACKNOWLEDGED'
  | 'CANCEL_REPLACE_REQUIRES_LOOKUP'
  | 'AMBIGUOUS_REQUIRES_LOOKUP'
  | 'IDENTITY_MISMATCH_REQUIRES_REVIEW'
  | 'AUTHORIZATION_FAILED'
  | 'RATE_LIMITED'
  | 'TERMINAL_REJECTED'
  | 'UNKNOWN_REQUIRES_REVIEW'
  | 'PRE_SEND_BLOCKED'

export interface BitgetDemoDispatchResult {
  environment: 'BITGET_DEMO'
  dispatchAttemptId: string
  authorizationId: string
  exchangeAccountId: string
  candidateHash: string
  operation: BitgetCandidateOperation
  endpoint: string
  category: BitgetDemoDispatchCategory
  reason: string
  requestBodyHash: string | null
  rateLimitReceiptHash: string | null
  httpStatus: number | null
  providerCode: string | null
  providerMessage: string | null
  acknowledgedOrderId: string | null
  acknowledgedClientOrderId: string | null
  recoveryLookups: readonly BitgetReadOnlyLookupInstruction[]
  demoRequestSent: boolean
  demoProviderMutationAttempted: boolean
  requiresReadOnlyRecovery: boolean
  providerAcknowledgmentVerified: boolean
  realProviderMutationAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
}

export interface BitgetDemoWriteTransportOptions {
  fetcher: typeof fetch
  rateLimitAuthority: BitgetDemoRateLimitAuthority
  now?: () => number
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
}

export class BitgetDemoWriteTransportError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BitgetDemoWriteTransportError'
    this.code = code
  }
}

class BitgetDemoRequestError extends Error {
  readonly reason: string
  readonly httpStatus: number | null

  constructor(reason: string, httpStatus: number | null = null) {
    super(reason)
    this.name = 'BitgetDemoRequestError'
    this.reason = reason
    this.httpStatus = httpStatus
  }
}

function requiredIdentifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!IDENTIFIER_PATTERN.test(normalized)) {
    throw new BitgetDemoWriteTransportError('AUTHORIZATION_INVALID', `${field} is invalid`)
  }
  return normalized
}

function requiredHash(value: string, field: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    throw new BitgetDemoWriteTransportError('HASH_INVALID', `${field} must be a SHA-256 digest`)
  }
  return normalized
}

function requiredTimestamp(value: string, field: string): { value: string; milliseconds: number } {
  const normalized = String(value ?? '').trim()
  const milliseconds = Date.parse(normalized)
  if (!normalized || !Number.isFinite(milliseconds)) {
    throw new BitgetDemoWriteTransportError('AUTHORIZATION_INVALID', `${field} must be an ISO timestamp`)
  }
  return { value: normalized, milliseconds }
}

function assertPermanentDemoLocks(input: BitgetDemoDispatchAuthorizationInput): void {
  if (
    input.environment !== BITGET_DEMO_WRITE_CONTRACT.environment
    || input.accountCoordinatorSerialized !== true
    || input.guardianClear !== true
    || input.riskApproved !== true
    || input.idempotencyClaimed !== true
    || input.demoMutationReviewed !== true
    || input.liveReleasePresent !== false
    || input.liveExecutionAllowed !== false
    || input.realFundsAllowed !== false
    || input.mainnetAllowed !== false
    || input.withdrawalsAllowed !== false
    || input.automaticRetryAllowed !== false
  ) {
    throw new BitgetDemoWriteTransportError(
      'AUTHORIZATION_LOCK_INVALID',
      'Bitget demo authorization is missing a required review proof or permanent live-execution lock',
    )
  }
}

export function verifyBitgetDemoDispatchAuthorization(
  input: BitgetDemoDispatchAuthorizationInput,
): VerifiedBitgetDemoDispatchAuthorization {
  assertPermanentDemoLocks(input)
  const validFrom = requiredTimestamp(input.validFrom, 'validFrom')
  const expiresAt = requiredTimestamp(input.expiresAt, 'expiresAt')
  if (
    expiresAt.milliseconds <= validFrom.milliseconds
    || expiresAt.milliseconds - validFrom.milliseconds > MAX_AUTHORIZATION_WINDOW_MS
  ) {
    throw new BitgetDemoWriteTransportError(
      'AUTHORIZATION_WINDOW_INVALID',
      'Bitget demo authorization must have a positive validity window of at most five minutes',
    )
  }

  const actorId = requiredIdentifier(input.actorId, 'actorId')
  const preparerId = requiredIdentifier(input.preparerId, 'preparerId')
  if (actorId === preparerId) {
    throw new BitgetDemoWriteTransportError(
      'SEPARATION_OF_DUTIES_REQUIRED',
      'Bitget demo authorization actor must differ from the candidate preparer',
    )
  }

  const evidence = Object.freeze({
    authorizationId: requiredIdentifier(input.authorizationId, 'authorizationId'),
    dispatchAttemptId: requiredIdentifier(input.dispatchAttemptId, 'dispatchAttemptId'),
    exchangeAccountId: requiredIdentifier(input.exchangeAccountId, 'exchangeAccountId'),
    actorId,
    preparerId,
    candidateHash: requiredHash(input.candidateHash, 'candidateHash'),
    authorizationEvidenceHash: requiredHash(input.authorizationEvidenceHash, 'authorizationEvidenceHash'),
    stepUpEvidenceHash: requiredHash(input.stepUpEvidenceHash, 'stepUpEvidenceHash'),
    riskEvidenceHash: requiredHash(input.riskEvidenceHash, 'riskEvidenceHash'),
    guardianEvidenceHash: requiredHash(input.guardianEvidenceHash, 'guardianEvidenceHash'),
    idempotencyEvidenceHash: requiredHash(input.idempotencyEvidenceHash, 'idempotencyEvidenceHash'),
    validFrom: validFrom.value,
    expiresAt: expiresAt.value,
    environment: BITGET_DEMO_WRITE_CONTRACT.environment,
    accountCoordinatorSerialized: true as const,
    guardianClear: true as const,
    riskApproved: true as const,
    idempotencyClaimed: true as const,
    demoMutationReviewed: true as const,
    liveReleasePresent: false as const,
    liveExecutionAllowed: false as const,
    realFundsAllowed: false as const,
    mainnetAllowed: false as const,
    withdrawalsAllowed: false as const,
    automaticRetryAllowed: false as const,
  })

  const authorization = {
    ...evidence,
    toJSON: () => evidence,
  } as VerifiedBitgetDemoDispatchAuthorization
  Object.defineProperty(authorization, VERIFIED_DEMO_AUTHORIZATION, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  })
  return Object.freeze(authorization)
}

export function assertBitgetDemoDispatchAuthorizationVerified(
  value: VerifiedBitgetDemoDispatchAuthorization,
): asserts value is VerifiedBitgetDemoDispatchAuthorization {
  if ((value as unknown as Record<symbol, unknown>)[VERIFIED_DEMO_AUTHORIZATION] !== true) {
    throw new BitgetDemoWriteTransportError(
      'AUTHORIZATION_NOT_VERIFIED',
      'Bitget demo dispatch requires an in-memory verified authorization',
    )
  }
}

function requiredCredential(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new BitgetDemoWriteTransportError('SIGNING_MATERIAL_UNAVAILABLE', `${field} is unavailable`)
  }
  return normalized
}

function expectedEndpoint(operation: BitgetCandidateOperation): string {
  if (operation === 'PLACE') return BITGET_MUTATION_EVIDENCE_ENDPOINTS.placeOrder
  if (operation === 'CANCEL') return BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelOrder
  return BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelReplaceOrder
}

function expectedBodyKeys(operation: BitgetCandidateOperation): ReadonlySet<string> {
  if (operation === 'PLACE') {
    return new Set(['symbol', 'side', 'orderType', 'force', 'clientOid', 'size', 'price'])
  }
  if (operation === 'CANCEL') return new Set(['symbol', 'orderId', 'clientOid'])
  return new Set(['symbol', 'price', 'size', 'newClientOid', 'orderId', 'clientOid'])
}

function assertUnsignedBody(candidate: BitgetUnsignedMutationCandidate): void {
  const keys = Object.keys(candidate.unsignedBody)
  const allowed = expectedBodyKeys(candidate.operation)
  if (keys.some((key) => !allowed.has(key))) {
    throw new BitgetDemoWriteTransportError('CANDIDATE_BODY_INVALID', 'Candidate body contains an unsupported field')
  }
  for (const [key, value] of Object.entries(candidate.unsignedBody)) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BitgetDemoWriteTransportError('CANDIDATE_BODY_INVALID', `Candidate body field ${key} is invalid`)
    }
  }

  const body = candidate.unsignedBody
  if (!body.symbol || body.symbol !== normalizeBitgetSymbol(body.symbol)) {
    throw new BitgetDemoWriteTransportError(
      'CANDIDATE_BODY_INVALID',
      'Candidate symbol is required and must use canonical Bitget form',
    )
  }
  const oldIdentityCount = Number(Boolean(body.orderId)) + Number(Boolean(body.clientOid))
  if (candidate.operation === 'PLACE') {
    if (!body.side || !body.orderType || !body.force || !body.clientOid || !body.size) {
      throw new BitgetDemoWriteTransportError('CANDIDATE_BODY_INVALID', 'Place candidate body is incomplete')
    }
    if (!['buy', 'sell'].includes(body.side) || !['market', 'limit'].includes(body.orderType)) {
      throw new BitgetDemoWriteTransportError('CANDIDATE_BODY_INVALID', 'Place side or order type is unsupported')
    }
    if ((body.orderType === 'limit') !== Boolean(body.price)) {
      throw new BitgetDemoWriteTransportError('CANDIDATE_BODY_INVALID', 'Place price does not match order type')
    }
  } else if (candidate.operation === 'CANCEL') {
    if (oldIdentityCount !== 1) {
      throw new BitgetDemoWriteTransportError('CANDIDATE_BODY_INVALID', 'Cancel requires exactly one identity')
    }
  } else if (!body.price || !body.size || !body.newClientOid || oldIdentityCount !== 1) {
    throw new BitgetDemoWriteTransportError('CANDIDATE_BODY_INVALID', 'Cancel-replace body is incomplete')
  }
}

export async function assertBitgetDemoCandidateIntegrity(
  candidate: BitgetUnsignedMutationCandidate,
): Promise<void> {
  const { candidateHash, ...evidence } = candidate
  if (await canonicalHash(evidence) !== candidateHash) {
    throw new BitgetDemoWriteTransportError('CANDIDATE_HASH_MISMATCH', 'Bitget candidate hash does not match its evidence')
  }
  if (
    candidate.provider !== 'BITGET'
    || candidate.method !== 'POST_EVIDENCE_ONLY'
    || candidate.endpoint !== expectedEndpoint(candidate.operation)
    || candidate.providerMutationAllowed !== false
    || candidate.executionAllowed !== false
    || candidate.automaticRetryAllowed !== false
    || candidate.transportSelected !== false
    || candidate.signingMaterialPresent !== false
    || !candidate.warnings.includes('execution_locked')
    || !candidate.warnings.includes('no_automatic_retry')
  ) {
    throw new BitgetDemoWriteTransportError('CANDIDATE_LOCK_INVALID', 'Bitget candidate safety locks are invalid')
  }
  const expectedLookupCount = candidate.operation === 'CANCEL_REPLACE' ? 2 : 1
  if (
    candidate.recoveryLookups.length !== expectedLookupCount
    || candidate.recoveryLookups.some((instruction) => (
      instruction.method !== 'GET'
      || instruction.endpoint !== BITGET_MUTATION_EVIDENCE_ENDPOINTS.orderInfo
    ))
  ) {
    throw new BitgetDemoWriteTransportError('RECOVERY_PLAN_INVALID', 'Candidate read-only recovery plan is invalid')
  }
  assertUnsignedBody(candidate)
}

function normalizeProviderText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 256)
  return normalized || null
}

function normalizeProviderIdentity(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return IDENTIFIER_PATTERN.test(normalized) ? normalized : null
}

function responseEnvelope(value: unknown): {
  code: string | null
  message: string | null
  orderId: string | null
  clientOrderId: string | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BitgetDemoWriteTransportError('RESPONSE_MALFORMED', 'Bitget demo response must be an object')
  }
  const root = value as Record<string, unknown>
  const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : {}
  return {
    code: normalizeProviderText(root.code),
    message: normalizeProviderText(root.msg ?? root.message),
    orderId: normalizeProviderIdentity(data.orderId),
    clientOrderId: normalizeProviderIdentity(data.clientOid ?? data.clientOrderId),
  }
}

function makeResult(input: {
  authorization: VerifiedBitgetDemoDispatchAuthorization
  candidate: BitgetUnsignedMutationCandidate
  category: BitgetDemoDispatchCategory
  reason: string
  requestBodyHash: string | null
  rateLimitReceiptHash: string | null
  httpStatus?: number | null
  providerCode?: string | null
  providerMessage?: string | null
  acknowledgedOrderId?: string | null
  acknowledgedClientOrderId?: string | null
  requestSent: boolean
  recoveryRequired: boolean
  providerAcknowledgmentVerified?: boolean
}): BitgetDemoDispatchResult {
  return Object.freeze({
    environment: BITGET_DEMO_WRITE_CONTRACT.environment,
    dispatchAttemptId: input.authorization.dispatchAttemptId,
    authorizationId: input.authorization.authorizationId,
    exchangeAccountId: input.authorization.exchangeAccountId,
    candidateHash: input.candidate.candidateHash,
    operation: input.candidate.operation,
    endpoint: input.candidate.endpoint,
    category: input.category,
    reason: input.reason,
    requestBodyHash: input.requestBodyHash,
    rateLimitReceiptHash: input.rateLimitReceiptHash,
    httpStatus: input.httpStatus ?? null,
    providerCode: input.providerCode ?? null,
    providerMessage: input.providerMessage ?? null,
    acknowledgedOrderId: input.acknowledgedOrderId ?? null,
    acknowledgedClientOrderId: input.acknowledgedClientOrderId ?? null,
    recoveryLookups: input.recoveryRequired ? input.candidate.recoveryLookups : Object.freeze([]),
    demoRequestSent: input.requestSent,
    demoProviderMutationAttempted: input.requestSent,
    requiresReadOnlyRecovery: input.recoveryRequired,
    providerAcknowledgmentVerified: input.providerAcknowledgmentVerified ?? false,
    realProviderMutationAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
  })
}

function expectedIdentity(candidate: BitgetUnsignedMutationCandidate): {
  orderId: string | null
  clientOrderId: string | null
} {
  if (candidate.operation === 'PLACE') {
    return { orderId: null, clientOrderId: candidate.unsignedBody.clientOid ?? null }
  }
  return {
    orderId: candidate.unsignedBody.orderId ?? null,
    clientOrderId: candidate.unsignedBody.clientOid ?? null,
  }
}

function classifyResponse(input: {
  authorization: VerifiedBitgetDemoDispatchAuthorization
  candidate: BitgetUnsignedMutationCandidate
  requestBodyHash: string
  rateLimitReceiptHash: string
  httpStatus: number
  code: string | null
  message: string | null
  orderId: string | null
  clientOrderId: string | null
}): BitgetDemoDispatchResult {
  const base = {
    authorization: input.authorization,
    candidate: input.candidate,
    requestBodyHash: input.requestBodyHash,
    rateLimitReceiptHash: input.rateLimitReceiptHash,
    httpStatus: input.httpStatus,
    providerCode: input.code,
    providerMessage: input.message,
    acknowledgedOrderId: input.orderId,
    acknowledgedClientOrderId: input.clientOrderId,
    requestSent: true,
  }
  const providerText = `${input.code ?? ''} ${input.message ?? ''}`.toLowerCase()
  if (input.httpStatus >= 500 || (input.code !== null && AMBIGUOUS_CODES.has(input.code))) {
    return makeResult({ ...base, category: 'AMBIGUOUS_REQUIRES_LOOKUP', reason: 'provider_result_is_ambiguous', recoveryRequired: true })
  }
  if (input.httpStatus === 401 || input.httpStatus === 403 || (input.code !== null && AUTHORIZATION_CODES.has(input.code))) {
    return makeResult({ ...base, category: 'AUTHORIZATION_FAILED', reason: 'provider_authorization_failed', recoveryRequired: false })
  }
  if (input.httpStatus === 429 || /rate.?limit|too many requests/.test(providerText)) {
    return makeResult({ ...base, category: 'RATE_LIMITED', reason: 'provider_rate_limit_reached', recoveryRequired: false })
  }
  if (/duplicate|client.?oid.*exist|already exists/.test(providerText)) {
    return makeResult({ ...base, category: 'AMBIGUOUS_REQUIRES_LOOKUP', reason: 'duplicate_identity_requires_lookup', recoveryRequired: true })
  }
  if (input.code !== null && input.code !== '00000') {
    if (TERMINAL_CODES.has(input.code)) {
      return makeResult({ ...base, category: 'TERMINAL_REJECTED', reason: 'provider_terminal_request_rejection', recoveryRequired: false })
    }
    return makeResult({ ...base, category: 'UNKNOWN_REQUIRES_REVIEW', reason: 'provider_code_is_not_certified', recoveryRequired: true })
  }
  if (input.httpStatus < 200 || input.httpStatus >= 300 || input.code !== '00000') {
    return makeResult({ ...base, category: 'UNKNOWN_REQUIRES_REVIEW', reason: 'provider_response_is_not_certified', recoveryRequired: true })
  }
  if (input.candidate.operation === 'CANCEL_REPLACE') {
    return makeResult({
      ...base,
      category: 'CANCEL_REPLACE_REQUIRES_LOOKUP',
      reason: 'cancel_replace_split_outcome_requires_both_lookups',
      recoveryRequired: true,
    })
  }

  const expected = expectedIdentity(input.candidate)
  if (
    (expected.orderId !== null && input.orderId !== expected.orderId)
    || (expected.clientOrderId !== null && input.clientOrderId !== expected.clientOrderId)
  ) {
    return makeResult({
      ...base,
      category: 'IDENTITY_MISMATCH_REQUIRES_REVIEW',
      reason: 'provider_acknowledgment_identity_mismatch',
      recoveryRequired: true,
    })
  }
  if (input.orderId === null && input.clientOrderId === null) {
    return makeResult({ ...base, category: 'AMBIGUOUS_REQUIRES_LOOKUP', reason: 'provider_acknowledgment_has_no_identity', recoveryRequired: true })
  }
  return makeResult({
    ...base,
    category: 'ACKNOWLEDGED',
    reason: 'provider_acknowledgment_identity_verified',
    recoveryRequired: false,
    providerAcknowledgmentVerified: true,
  })
}

function assertRateLimitClaim(
  requested: Readonly<BitgetDemoRateLimitClaimInput>,
  claim: Readonly<BitgetDemoRateLimitClaim>,
): void {
  if (
    claim.exchangeAccountId !== requested.exchangeAccountId
    || claim.dispatchAttemptId !== requested.dispatchAttemptId
    || claim.candidateHash !== requested.candidateHash
    || claim.operation !== requested.operation
    || claim.windowMs !== requested.windowMs
    || claim.maximumRequests !== requested.maximumRequests
    || typeof claim.allowed !== 'boolean'
    || !Number.isSafeInteger(claim.claimedAtMs)
    || Math.abs(claim.claimedAtMs - requested.requestedAtMs) > requested.windowMs
  ) {
    throw new BitgetDemoWriteTransportError('RATE_LIMIT_CLAIM_INVALID', 'Rate-limit authority returned an invalid claim')
  }
  if (claim.receiptHash !== requiredHash(claim.receiptHash, 'rateLimitReceiptHash')) {
    throw new BitgetDemoWriteTransportError('RATE_LIMIT_CLAIM_INVALID', 'Rate-limit receipt hash is not canonical')
  }
}

async function readBoundedResponseBody(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = Number(contentLength)
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new BitgetDemoRequestError('provider_content_length_is_invalid', response.status)
    }
    if (parsedLength > maxResponseBytes) {
      throw new BitgetDemoRequestError('provider_response_exceeds_size_limit', response.status)
    }
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  let aborted = false
  const abortReader = () => {
    aborted = true
    void reader.cancel('demo response deadline exceeded').catch(() => undefined)
  }
  signal.addEventListener('abort', abortReader, { once: true })
  if (signal.aborted) abortReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (aborted) {
        throw new BitgetDemoRequestError('demo_response_timed_out', response.status)
      }
      if (done) break
      if (!value) continue
      totalBytes += value.byteLength
      if (totalBytes > maxResponseBytes) {
        await reader.cancel('response byte limit exceeded')
        throw new BitgetDemoRequestError('provider_response_exceeds_size_limit', response.status)
      }
      chunks.push(value)
    }
  } finally {
    signal.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
}

async function performBoundedDemoRequest(input: {
  fetcher: typeof fetch
  url: string
  request: RequestInit
  timeoutMs: number
  maxResponseBytes: number
}): Promise<{ response: Response; body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs)
  const deadline = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener('abort', () => {
      reject(new BitgetDemoRequestError('demo_request_timed_out'))
    }, { once: true })
  })
  try {
    let response: Response
    try {
      response = await Promise.race([
        input.fetcher(input.url, { ...input.request, signal: controller.signal }),
        deadline,
      ])
    } catch (error) {
      if (error instanceof BitgetDemoRequestError) throw error
      throw new BitgetDemoRequestError(
        controller.signal.aborted ? 'demo_request_timed_out' : 'demo_request_connection_failed',
      )
    }
    try {
      return {
        response,
        body: await readBoundedResponseBody(response, input.maxResponseBytes, controller.signal),
      }
    } catch (error) {
      if (error instanceof BitgetDemoRequestError) throw error
      throw new BitgetDemoRequestError(
        controller.signal.aborted ? 'demo_response_timed_out' : 'demo_response_read_failed',
        response.status,
      )
    }
  } finally {
    clearTimeout(timer)
  }
}

export class BitgetDemoWriteTransport {
  private readonly fetcher: typeof fetch
  private readonly rateLimitAuthority: BitgetDemoRateLimitAuthority
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly maxRequestBytes: number
  private readonly maxResponseBytes: number
  private readonly consumedAttemptIds = new Set<string>()

  constructor(options: BitgetDemoWriteTransportOptions) {
    if (typeof options.fetcher !== 'function') {
      throw new BitgetDemoWriteTransportError('FETCHER_REQUIRED', 'Bitget demo transport requires an injected fetcher')
    }
    if (!options.rateLimitAuthority || typeof options.rateLimitAuthority.claim !== 'function') {
      throw new BitgetDemoWriteTransportError('RATE_LIMIT_AUTHORITY_REQUIRED', 'Account rate-limit authority is required')
    }
    this.fetcher = options.fetcher
    this.rateLimitAuthority = options.rateLimitAuthority
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.maxRequestBytes = options.maxRequestBytes ?? 16_384
    this.maxResponseBytes = options.maxResponseBytes ?? 1_000_000
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
      throw new BitgetDemoWriteTransportError('TIMEOUT_INVALID', 'timeoutMs must be 100-30000')
    }
    if (!Number.isInteger(this.maxRequestBytes) || this.maxRequestBytes < 512 || this.maxRequestBytes > 65_536) {
      throw new BitgetDemoWriteTransportError('REQUEST_LIMIT_INVALID', 'maxRequestBytes must be 512-65536')
    }
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1_024 || this.maxResponseBytes > 5_000_000) {
      throw new BitgetDemoWriteTransportError('RESPONSE_LIMIT_INVALID', 'maxResponseBytes must be 1024-5000000')
    }
  }

  async dispatch(
    candidate: BitgetUnsignedMutationCandidate,
    authorization: VerifiedBitgetDemoDispatchAuthorization,
    signingMaterial: BitgetDemoSigningMaterial,
  ): Promise<BitgetDemoDispatchResult> {
    assertBitgetDemoDispatchAuthorizationVerified(authorization)
    await assertBitgetDemoCandidateIntegrity(candidate)
    const now = this.now()
    if (!Number.isSafeInteger(now) || String(now).length !== 13) {
      throw new BitgetDemoWriteTransportError('CLOCK_INVALID', 'Bitget demo signing clock must return Unix milliseconds')
    }
    if (
      now < Date.parse(authorization.validFrom)
      || now >= Date.parse(authorization.expiresAt)
      || now < Date.parse(candidate.builtAt)
      || now >= Date.parse(candidate.expiresAt)
    ) {
      throw new BitgetDemoWriteTransportError('AUTHORIZATION_EXPIRED', 'Authorization or candidate is outside its validity window')
    }
    if (authorization.candidateHash !== candidate.candidateHash) {
      throw new BitgetDemoWriteTransportError('AUTHORIZATION_BINDING_MISMATCH', 'Authorization does not bind this candidate')
    }
    if (this.consumedAttemptIds.has(authorization.dispatchAttemptId)) {
      throw new BitgetDemoWriteTransportError('DISPATCH_ATTEMPT_ALREADY_USED', 'Dispatch attempt is one-shot and cannot be replayed')
    }
    this.consumedAttemptIds.add(authorization.dispatchAttemptId)

    const timestamp = String(now)
    const requestBody = canonicalJson(candidate.unsignedBody)
    const requestBytes = new TextEncoder().encode(requestBody).byteLength
    if (requestBytes > this.maxRequestBytes) {
      throw new BitgetDemoWriteTransportError('REQUEST_TOO_LARGE', 'Bitget demo request exceeds configured size limit')
    }
    const requestBodyHash = await sha256Hex(requestBody)
    const maximumRequests = BITGET_DEMO_WRITE_CONTRACT.requestLimitsPerSecond[candidate.operation]
    const rateLimitRequest = Object.freeze({
      exchangeAccountId: authorization.exchangeAccountId,
      dispatchAttemptId: authorization.dispatchAttemptId,
      candidateHash: candidate.candidateHash,
      operation: candidate.operation,
      endpoint: candidate.endpoint,
      requestedAtMs: now,
      windowMs: 1000 as const,
      maximumRequests,
    })

    let rateLimitClaim: Readonly<BitgetDemoRateLimitClaim>
    try {
      rateLimitClaim = await this.rateLimitAuthority.claim(rateLimitRequest)
      assertRateLimitClaim(rateLimitRequest, rateLimitClaim)
    } catch (error) {
      if (error instanceof BitgetDemoWriteTransportError) throw error
      return makeResult({
        authorization,
        candidate,
        category: 'PRE_SEND_BLOCKED',
        reason: 'account_rate_limit_authority_failed',
        requestBodyHash,
        rateLimitReceiptHash: null,
        requestSent: false,
        recoveryRequired: false,
      })
    }
    if (!rateLimitClaim.allowed) {
      return makeResult({
        authorization,
        candidate,
        category: 'RATE_LIMITED',
        reason: 'account_rate_limit_claim_denied',
        requestBodyHash,
        rateLimitReceiptHash: rateLimitClaim.receiptHash,
        requestSent: false,
        recoveryRequired: false,
      })
    }

    const accessIdentifier = requiredCredential(signingMaterial.apiKey, 'apiKey')
    const passphrase = requiredCredential(signingMaterial.passphrase, 'passphrase')
    const hmacSigningKey = requiredCredential(signingMaterial.secretKey, 'secretKey')
    const signature = await signBitgetPrehash(
      hmacSigningKey,
      `${timestamp}POST${candidate.endpoint}${requestBody}`,
    )
    const url = new URL(candidate.endpoint, BITGET_API_ORIGIN)
    if (url.origin !== BITGET_API_ORIGIN || url.pathname !== candidate.endpoint || url.search) {
      throw new BitgetDemoWriteTransportError('ORIGIN_INVALID', 'Bitget demo request origin or path is invalid')
    }
    const headers = new Headers({
      Accept: 'application/json',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      locale: 'en-US',
      'ACCESS-KEY': accessIdentifier,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': passphrase,
      [BITGET_DEMO_WRITE_CONTRACT.requestHeaderName]: BITGET_DEMO_WRITE_CONTRACT.requestHeaderValue,
    })

    let response: Response
    let responseBody: string
    try {
      const bounded = await performBoundedDemoRequest({
        fetcher: this.fetcher,
        url: url.toString(),
        request: {
          method: 'POST',
          headers,
          body: requestBody,
          redirect: 'error',
        },
        timeoutMs: this.timeoutMs,
        maxResponseBytes: this.maxResponseBytes,
      })
      response = bounded.response
      responseBody = bounded.body
    } catch (error) {
      const requestError = error instanceof BitgetDemoRequestError
        ? error
        : new BitgetDemoRequestError('demo_request_failed_closed')
      return makeResult({
        authorization,
        candidate,
        category: 'AMBIGUOUS_REQUIRES_LOOKUP',
        reason: requestError.reason,
        requestBodyHash,
        rateLimitReceiptHash: rateLimitClaim.receiptHash,
        httpStatus: requestError.httpStatus,
        requestSent: true,
        recoveryRequired: true,
      })
    }
    let envelope
    try {
      envelope = responseEnvelope(JSON.parse(responseBody) as unknown)
    } catch {
      return makeResult({
        authorization,
        candidate,
        category: 'AMBIGUOUS_REQUIRES_LOOKUP',
        reason: 'provider_response_is_not_valid_json',
        requestBodyHash,
        rateLimitReceiptHash: rateLimitClaim.receiptHash,
        httpStatus: response.status,
        requestSent: true,
        recoveryRequired: true,
      })
    }
    return classifyResponse({
      authorization,
      candidate,
      requestBodyHash,
      rateLimitReceiptHash: rateLimitClaim.receiptHash,
      httpStatus: response.status,
      ...envelope,
    })
  }
}
