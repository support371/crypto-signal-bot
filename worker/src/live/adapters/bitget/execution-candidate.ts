import { canonicalHash } from '../../canonical-json.ts'
import { CandidateExecutionLockedError, type OrderPreviewRequest } from '../../exchange-contracts.ts'
import type { OrderIntent, ProductRules } from '../../domain.ts'
import { validateOrderAgainstProductRules } from '../../product-rules.ts'
import { normalizeBitgetSymbol } from './endpoints.ts'

export const BITGET_MUTATION_EVIDENCE_ENDPOINTS = Object.freeze({
  placeOrder: '/api/v2/spot/trade/place-order',
  cancelOrder: '/api/v2/spot/trade/cancel-order',
  cancelReplaceOrder: '/api/v2/spot/trade/cancel-replace-order',
  orderInfo: '/api/v2/spot/trade/orderInfo',
} as const)

export type BitgetCandidateOperation = 'PLACE' | 'CANCEL' | 'CANCEL_REPLACE'
export type BitgetTimeInForce = 'gtc' | 'post_only' | 'fok' | 'ioc'

export interface BitgetOrderIdentity {
  orderId: string | null
  clientOrderId: string | null
}

export interface BitgetReadOnlyLookupInstruction {
  method: 'GET'
  endpoint: typeof BITGET_MUTATION_EVIDENCE_ENDPOINTS.orderInfo
  query: Readonly<{
    symbol: string
    orderId?: string
    clientOid?: string
  }>
}

export interface BitgetUnsignedMutationCandidate {
  provider: 'BITGET'
  operation: BitgetCandidateOperation
  method: 'POST_EVIDENCE_ONLY'
  endpoint: string
  unsignedBody: Readonly<Record<string, string>>
  recoveryLookups: readonly BitgetReadOnlyLookupInstruction[]
  warnings: readonly string[]
  builtAt: string
  expiresAt: string
  providerMutationAllowed: false
  executionAllowed: false
  automaticRetryAllowed: false
  transportSelected: false
  signingMaterialPresent: false
  candidateHash: string
}

export interface BuildBitgetPlaceCandidateInput {
  request: OrderPreviewRequest
  productRules: ProductRules
  clientOrderId: string
  previewHash: string
  force: BitgetTimeInForce
  builtAt: string
  expiresAt: string
}

export interface BuildBitgetCancelCandidateInput {
  productId: string
  identity: BitgetOrderIdentity
  builtAt: string
  expiresAt: string
}

export interface BuildBitgetCancelReplaceCandidateInput {
  productId: string
  oldIdentity: BitgetOrderIdentity
  replacement: BuildBitgetPlaceCandidateInput
  builtAt: string
  expiresAt: string
}

export type BitgetCandidateOutcomeCategory =
  | 'ACKNOWLEDGED'
  | 'AUTHORIZATION_FAILED'
  | 'RATE_LIMITED'
  | 'DUPLICATE_CLIENT_ORDER_ID'
  | 'AMBIGUOUS_REQUIRES_LOOKUP'
  | 'IDENTITY_MISMATCH_REQUIRES_REVIEW'
  | 'TERMINAL_REJECTED'

export interface BitgetCandidateOutcomeInput {
  httpStatus: number | null
  providerCode: string | null
  providerMessage: string | null
  transportError: 'TIMEOUT' | 'CONNECTION' | 'INVALID_RESPONSE' | null
  expectedClientOrderId: string | null
  expectedExchangeOrderId: string | null
  acknowledgedClientOrderId: string | null
  acknowledgedExchangeOrderId: string | null
}

export interface BitgetCandidateOutcome {
  category: BitgetCandidateOutcomeCategory
  recoveryRequired: boolean
  automaticRetryAllowed: false
  providerAcknowledgmentVerified: boolean
  reason: string
}

const CLIENT_ORDER_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function normalizeClientOrderId(value: string, field = 'clientOrderId'): string {
  const normalized = required(value, field)
  if (!CLIENT_ORDER_ID_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must contain 1-64 letters, digits, colon, underscore, or hyphen characters`)
  }
  return normalized
}

function normalizeHash(value: string, field: string): string {
  const normalized = required(value, field).toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${field} must be a SHA-256 hex digest`)
  return normalized
}

function parseTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be an ISO timestamp`)
  return parsed
}

function validateWindow(builtAt: string, expiresAt: string): void {
  const builtAtMs = parseTimestamp(builtAt, 'builtAt')
  const expiresAtMs = parseTimestamp(expiresAt, 'expiresAt')
  if (expiresAtMs <= builtAtMs) throw new TypeError('expiresAt must be later than builtAt')
}

function validateIdentity(identity: BitgetOrderIdentity, field: string): BitgetOrderIdentity {
  const orderId = identity.orderId === null ? null : required(identity.orderId, `${field}.orderId`)
  const clientOrderId = identity.clientOrderId === null
    ? null
    : normalizeClientOrderId(identity.clientOrderId, `${field}.clientOrderId`)
  if ((orderId === null) === (clientOrderId === null)) {
    throw new TypeError(`${field} must contain exactly one of orderId or clientOrderId`)
  }
  return Object.freeze({ orderId, clientOrderId })
}

function lookup(productId: string, identity: BitgetOrderIdentity): BitgetReadOnlyLookupInstruction {
  const symbol = normalizeBitgetSymbol(productId)
  const query = identity.orderId !== null
    ? { symbol, orderId: identity.orderId }
    : { symbol, clientOid: identity.clientOrderId! }
  return Object.freeze({
    method: 'GET' as const,
    endpoint: BITGET_MUTATION_EVIDENCE_ENDPOINTS.orderInfo,
    query: Object.freeze(query),
  })
}

function validationIntent(input: BuildBitgetPlaceCandidateInput): OrderIntent {
  return {
    intentId: 'bitget-execution-candidate',
    idempotencyKey: `candidate:${normalizeClientOrderId(input.clientOrderId)}`,
    correlationId: `candidate:${normalizeHash(input.previewHash, 'previewHash').slice(0, 24)}`,
    exchangeAccountId: 'execution-candidate-account',
    productId: input.request.productId,
    side: input.request.side,
    orderType: input.request.orderType,
    baseQuantity: input.request.baseQuantity,
    quoteNotional: input.request.quoteNotional,
    limitPrice: input.request.limitPrice,
    stopPrice: input.request.stopPrice,
    strategyId: null,
    requestedBy: 'execution-candidate-builder',
    requestedAt: input.builtAt,
  }
}

function placeBody(input: BuildBitgetPlaceCandidateInput): Readonly<Record<string, string>> {
  const request = input.request
  if (request.orderType !== 'MARKET' && request.orderType !== 'LIMIT') {
    throw new TypeError('Bitget execution candidate supports only MARKET and LIMIT spot orders')
  }
  if (request.stopPrice !== null) throw new TypeError('Bitget execution candidate does not accept stopPrice')

  const body: Record<string, string> = {
    symbol: normalizeBitgetSymbol(request.productId),
    side: request.side.toLowerCase(),
    orderType: request.orderType.toLowerCase(),
    force: input.force,
    clientOid: normalizeClientOrderId(input.clientOrderId),
  }

  if (request.orderType === 'MARKET' && request.side === 'BUY') {
    if (request.quoteNotional === null || request.baseQuantity !== null) {
      throw new TypeError('Bitget market-buy candidate must remain quote-sized')
    }
    body.size = request.quoteNotional
  } else {
    if (request.baseQuantity === null || request.quoteNotional !== null) {
      throw new TypeError('Bitget candidate requires base quantity for this side/order type')
    }
    body.size = request.baseQuantity
  }

  if (request.orderType === 'LIMIT') {
    if (request.limitPrice === null) throw new TypeError('Bitget limit candidate requires limitPrice')
    body.price = request.limitPrice
  } else if (request.limitPrice !== null) {
    throw new TypeError('Bitget market candidate must not contain limitPrice')
  }

  return Object.freeze(body)
}

function baseCandidateEvidence(input: {
  operation: BitgetCandidateOperation
  endpoint: string
  unsignedBody: Readonly<Record<string, string>>
  recoveryLookups: readonly BitgetReadOnlyLookupInstruction[]
  warnings: readonly string[]
  builtAt: string
  expiresAt: string
}) {
  validateWindow(input.builtAt, input.expiresAt)
  return {
    provider: 'BITGET' as const,
    operation: input.operation,
    method: 'POST_EVIDENCE_ONLY' as const,
    endpoint: input.endpoint,
    unsignedBody: input.unsignedBody,
    recoveryLookups: input.recoveryLookups,
    warnings: input.warnings,
    builtAt: input.builtAt,
    expiresAt: input.expiresAt,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
    automaticRetryAllowed: false as const,
    transportSelected: false as const,
    signingMaterialPresent: false as const,
  }
}

async function finalizeCandidate(
  evidence: ReturnType<typeof baseCandidateEvidence>,
): Promise<BitgetUnsignedMutationCandidate> {
  const candidateHash = await canonicalHash(evidence)
  return Object.freeze({ ...evidence, candidateHash })
}

export async function buildBitgetPlaceOrderCandidate(
  input: BuildBitgetPlaceCandidateInput,
): Promise<BitgetUnsignedMutationCandidate> {
  validateWindow(input.builtAt, input.expiresAt)
  normalizeHash(input.previewHash, 'previewHash')
  const validation = validateOrderAgainstProductRules(
    validationIntent(input),
    input.productRules,
    new Date(input.builtAt),
  )
  if (!validation.valid) {
    throw new TypeError(`Bitget place candidate failed product validation: ${validation.reasons.join(',')}`)
  }

  const identity = Object.freeze({ orderId: null, clientOrderId: normalizeClientOrderId(input.clientOrderId) })
  const warnings = [
    'execution_locked',
    'unsigned_request_evidence_only',
    'mandatory_read_only_recovery',
    'no_automatic_retry',
  ]
  if (input.request.orderType === 'MARKET') {
    warnings.push('market_force_contract_requires_final_provider_verification')
  }

  return finalizeCandidate(baseCandidateEvidence({
    operation: 'PLACE',
    endpoint: BITGET_MUTATION_EVIDENCE_ENDPOINTS.placeOrder,
    unsignedBody: Object.freeze({
      ...placeBody(input),
      previewHash: normalizeHash(input.previewHash, 'previewHash'),
    }),
    recoveryLookups: Object.freeze([lookup(input.request.productId, identity)]),
    warnings: Object.freeze(warnings),
    builtAt: input.builtAt,
    expiresAt: input.expiresAt,
  }))
}

export async function buildBitgetCancelOrderCandidate(
  input: BuildBitgetCancelCandidateInput,
): Promise<BitgetUnsignedMutationCandidate> {
  const identity = validateIdentity(input.identity, 'identity')
  const body: Record<string, string> = { symbol: normalizeBitgetSymbol(input.productId) }
  if (identity.orderId !== null) body.orderId = identity.orderId
  else body.clientOid = identity.clientOrderId!

  return finalizeCandidate(baseCandidateEvidence({
    operation: 'CANCEL',
    endpoint: BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelOrder,
    unsignedBody: Object.freeze(body),
    recoveryLookups: Object.freeze([lookup(input.productId, identity)]),
    warnings: Object.freeze([
      'execution_locked',
      'unsigned_request_evidence_only',
      'mandatory_read_only_recovery',
      'no_automatic_retry',
    ]),
    builtAt: input.builtAt,
    expiresAt: input.expiresAt,
  }))
}

export async function buildBitgetCancelReplaceOrderCandidate(
  input: BuildBitgetCancelReplaceCandidateInput,
): Promise<BitgetUnsignedMutationCandidate> {
  if (normalizeBitgetSymbol(input.productId) !== normalizeBitgetSymbol(input.replacement.request.productId)) {
    throw new TypeError('cancel-replace product must match replacement product')
  }
  const oldIdentity = validateIdentity(input.oldIdentity, 'oldIdentity')
  const replacementCandidate = await buildBitgetPlaceOrderCandidate(input.replacement)
  const newIdentity = Object.freeze({
    orderId: null,
    clientOrderId: normalizeClientOrderId(input.replacement.clientOrderId, 'replacement.clientOrderId'),
  })
  const body: Record<string, string> = {
    symbol: normalizeBitgetSymbol(input.productId),
    newClientOid: newIdentity.clientOrderId!,
    replacementCandidateHash: replacementCandidate.candidateHash,
  }
  if (oldIdentity.orderId !== null) body.orderId = oldIdentity.orderId
  else body.clientOid = oldIdentity.clientOrderId!

  return finalizeCandidate(baseCandidateEvidence({
    operation: 'CANCEL_REPLACE',
    endpoint: BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelReplaceOrder,
    unsignedBody: Object.freeze(body),
    recoveryLookups: Object.freeze([
      lookup(input.productId, oldIdentity),
      lookup(input.productId, newIdentity),
    ]),
    warnings: Object.freeze([
      'execution_locked',
      'unsigned_request_evidence_only',
      'split_outcome_requires_both_identity_lookups',
      'mandatory_read_only_recovery',
      'no_automatic_retry',
    ]),
    builtAt: input.builtAt,
    expiresAt: input.expiresAt,
  }))
}

function normalizedProviderText(input: BitgetCandidateOutcomeInput): string {
  return `${input.providerCode ?? ''} ${input.providerMessage ?? ''}`.trim().toLowerCase()
}

function outcome(
  category: BitgetCandidateOutcomeCategory,
  reason: string,
  recoveryRequired: boolean,
  providerAcknowledgmentVerified = false,
): BitgetCandidateOutcome {
  return Object.freeze({
    category,
    recoveryRequired,
    automaticRetryAllowed: false,
    providerAcknowledgmentVerified,
    reason,
  })
}

export function classifyBitgetCandidateOutcome(
  input: BitgetCandidateOutcomeInput,
): BitgetCandidateOutcome {
  const providerText = normalizedProviderText(input)
  if (input.transportError !== null || input.httpStatus === null || input.httpStatus >= 500) {
    return outcome('AMBIGUOUS_REQUIRES_LOOKUP', 'transport_or_server_result_is_ambiguous', true)
  }
  if (
    input.httpStatus === 401
    || input.httpStatus === 403
    || /auth|permission|signature|api key|apikey/.test(providerText)
  ) {
    return outcome('AUTHORIZATION_FAILED', 'provider_authorization_failed', false)
  }
  if (input.httpStatus === 429 || /rate.?limit|too many requests/.test(providerText)) {
    return outcome('RATE_LIMITED', 'provider_rate_limit_reached', false)
  }
  if (/duplicate|client.?oid.*exist|already exists/.test(providerText)) {
    return outcome('DUPLICATE_CLIENT_ORDER_ID', 'client_order_id_requires_read_only_lookup', true)
  }
  if (input.httpStatus >= 200 && input.httpStatus < 300) {
    if (
      input.expectedClientOrderId !== null
      && input.acknowledgedClientOrderId !== input.expectedClientOrderId
    ) {
      return outcome('IDENTITY_MISMATCH_REQUIRES_REVIEW', 'provider_client_order_identity_mismatch', true)
    }
    if (
      input.expectedExchangeOrderId !== null
      && input.acknowledgedExchangeOrderId !== input.expectedExchangeOrderId
    ) {
      return outcome('IDENTITY_MISMATCH_REQUIRES_REVIEW', 'provider_exchange_order_identity_mismatch', true)
    }
    if (input.acknowledgedClientOrderId === null && input.acknowledgedExchangeOrderId === null) {
      return outcome('AMBIGUOUS_REQUIRES_LOOKUP', 'provider_acknowledgment_has_no_order_identity', true)
    }
    return outcome('ACKNOWLEDGED', 'provider_acknowledgment_identity_verified', false, true)
  }
  return outcome('TERMINAL_REJECTED', 'provider_terminal_rejection', false)
}

export class BitgetExecutionCandidateAdapter {
  buildPlaceCandidate(input: BuildBitgetPlaceCandidateInput): Promise<BitgetUnsignedMutationCandidate> {
    return buildBitgetPlaceOrderCandidate(input)
  }

  buildCancelCandidate(input: BuildBitgetCancelCandidateInput): Promise<BitgetUnsignedMutationCandidate> {
    return buildBitgetCancelOrderCandidate(input)
  }

  buildCancelReplaceCandidate(
    input: BuildBitgetCancelReplaceCandidateInput,
  ): Promise<BitgetUnsignedMutationCandidate> {
    return buildBitgetCancelReplaceOrderCandidate(input)
  }

  submitPlaceOrder(): never {
    throw new CandidateExecutionLockedError('bitget.submitPlaceOrder')
  }

  submitCancelOrder(): never {
    throw new CandidateExecutionLockedError('bitget.submitCancelOrder')
  }

  submitCancelReplaceOrder(): never {
    throw new CandidateExecutionLockedError('bitget.submitCancelReplaceOrder')
  }
}
