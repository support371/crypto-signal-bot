import { canonicalHash } from '../../canonical-json.ts'
import {
  CandidateExecutionLockedError,
  type FinancialMutationAdapter,
  type OrderPreviewRequest,
  type OrderPreviewResult,
} from '../../exchange-contracts.ts'
import type { OrderIntent, ProductRules } from '../../domain.ts'
import {
  addDecimal,
  asDecimalString,
  compareDecimal,
  decimalScale,
  divideDecimalDown,
  multiplyDecimal,
  quantizeDown,
  subtractNonNegativeDecimal,
  type DecimalString,
} from '../../decimal.ts'
import { validateOrderAgainstProductRules } from '../../product-rules.ts'

export interface BitgetReferencePrice {
  productId: string
  price: DecimalString
  observedAt: string
  expiresAt: string
}

export interface BitgetLockedPreviewOptions {
  productRules: ProductRules
  referencePrice: BitgetReferencePrice
  feeRate: DecimalString
  slippageBps: number
  now?: () => Date
}

export interface BitgetLockedPreviewResult extends OrderPreviewResult {
  previewSource: 'LOCAL_LOCKED_ESTIMATE'
  executionAllowed: false
  estimatedBaseQuantity: DecimalString | null
  estimatedQuoteValue: DecimalString | null
  estimatedTotalDebit: DecimalString | null
  estimatedNetCredit: DecimalString | null
  expiresAt: string | null
  warnings: readonly string[]
}

const TEN_THOUSAND = asDecimalString('10000')
const ZERO = asDecimalString('0')
const MAX_FEE_RATE = asDecimalString('0.05')
const MAX_SLIPPAGE_BPS = 500

function validTimestamp(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeProductId(value: string): string {
  return value.trim().toUpperCase()
}

function validateConfiguration(options: BitgetLockedPreviewOptions, now: Date): string[] {
  const errors: string[] = []
  const productId = normalizeProductId(options.productRules.productId)
  if (normalizeProductId(options.referencePrice.productId) !== productId) {
    errors.push('reference_price_product_mismatch')
  }
  if (compareDecimal(options.referencePrice.price, ZERO) <= 0) {
    errors.push('reference_price_not_positive')
  }
  if (compareDecimal(options.feeRate, ZERO) < 0 || compareDecimal(options.feeRate, MAX_FEE_RATE) > 0) {
    errors.push('fee_rate_out_of_range')
  }
  if (!Number.isInteger(options.slippageBps) || options.slippageBps < 0 || options.slippageBps > MAX_SLIPPAGE_BPS) {
    errors.push('slippage_bps_out_of_range')
  }

  const nowMs = now.getTime()
  const observedAtMs = validTimestamp(options.referencePrice.observedAt)
  const expiresAtMs = validTimestamp(options.referencePrice.expiresAt)
  if (!Number.isFinite(nowMs)) errors.push('preview_time_invalid')
  if (observedAtMs === null || expiresAtMs === null || expiresAtMs <= observedAtMs) {
    errors.push('reference_price_time_window_invalid')
  } else {
    if (observedAtMs > nowMs) errors.push('reference_price_observed_in_future')
    if (expiresAtMs <= nowMs) errors.push('reference_price_stale')
  }
  return errors
}

function providerSizingErrors(request: OrderPreviewRequest): string[] {
  const errors: string[] = []
  if (request.orderType === 'STOP' || request.orderType === 'STOP_LIMIT') {
    errors.push('bitget_preview_order_type_unsupported')
  }
  if (request.orderType === 'MARKET' && request.side === 'BUY') {
    if (request.quoteNotional === null || request.baseQuantity !== null) {
      errors.push('bitget_market_buy_requires_quote_notional')
    }
  } else if (request.baseQuantity === null || request.quoteNotional !== null) {
    errors.push('bitget_order_requires_base_quantity')
  }
  return errors
}

function orderIntent(request: OrderPreviewRequest, now: Date): OrderIntent {
  return {
    intentId: 'preview-intent',
    idempotencyKey: 'preview:locked:0001',
    correlationId: 'preview-correlation',
    exchangeAccountId: 'preview-account',
    productId: normalizeProductId(request.productId),
    side: request.side,
    orderType: request.orderType,
    baseQuantity: request.baseQuantity,
    quoteNotional: request.quoteNotional,
    limitPrice: request.limitPrice,
    stopPrice: request.stopPrice,
    strategyId: null,
    requestedBy: 'locked-preview',
    requestedAt: now.toISOString(),
  }
}

function slippageAdjustment(price: DecimalString, bps: number): DecimalString {
  if (bps === 0) return ZERO
  return divideDecimalDown(
    multiplyDecimal(price, asDecimalString(String(bps))),
    TEN_THOUSAND,
    Math.min(36, Math.max(18, decimalScale(price) + 8)),
  )
}

function estimatedFillPrice(
  request: OrderPreviewRequest,
  referencePrice: DecimalString,
  slippageBps: number,
): DecimalString {
  if (request.orderType === 'LIMIT') {
    if (request.limitPrice === null) throw new TypeError('limit price is required')
    return request.limitPrice
  }

  const adjustment = slippageAdjustment(referencePrice, slippageBps)
  return request.side === 'BUY'
    ? addDecimal(referencePrice, adjustment)
    : subtractNonNegativeDecimal(referencePrice, adjustment, 'estimatedFillPrice')
}

function resultExpiry(options: BitgetLockedPreviewOptions): string | null {
  const productExpiry = validTimestamp(options.productRules.expiresAt)
  const priceExpiry = validTimestamp(options.referencePrice.expiresAt)
  if (productExpiry === null || priceExpiry === null) return null
  return new Date(Math.min(productExpiry, priceExpiry)).toISOString()
}

async function rejectedPreview(
  options: BitgetLockedPreviewOptions,
  request: OrderPreviewRequest,
  errors: readonly string[],
): Promise<BitgetLockedPreviewResult> {
  const warnings = Object.freeze(['execution_locked', 'local_estimate_not_exchange_guarantee'])
  const evidence = {
    exchange: 'BITGET',
    request,
    productRules: options.productRules,
    referencePrice: options.referencePrice,
    feeRate: options.feeRate,
    slippageBps: options.slippageBps,
    errors,
    warnings,
    executionAllowed: false,
  }
  const rawResponseHash = await canonicalHash(evidence)
  return Object.freeze({
    accepted: false,
    previewId: null,
    estimatedTotal: null,
    estimatedFees: null,
    estimatedFillPrice: null,
    errors: Object.freeze([...errors]),
    rawResponseHash,
    previewSource: 'LOCAL_LOCKED_ESTIMATE',
    executionAllowed: false,
    estimatedBaseQuantity: null,
    estimatedQuoteValue: null,
    estimatedTotalDebit: null,
    estimatedNetCredit: null,
    expiresAt: resultExpiry(options),
    warnings,
  })
}

export async function previewBitgetOrderLocked(
  options: BitgetLockedPreviewOptions,
  request: OrderPreviewRequest,
): Promise<BitgetLockedPreviewResult> {
  const now = options.now?.() ?? new Date()
  const errors = [
    ...validateConfiguration(options, now),
    ...providerSizingErrors(request),
  ]
  const validation = validateOrderAgainstProductRules(
    orderIntent(request, now),
    options.productRules,
    now,
  )
  errors.push(...validation.reasons)

  const uniqueErrors = Array.from(new Set(errors)).sort()
  if (uniqueErrors.length > 0) return rejectedPreview(options, request, uniqueErrors)

  const fillPrice = estimatedFillPrice(request, options.referencePrice.price, options.slippageBps)
  const baseScale = Math.min(36, Math.max(decimalScale(options.productRules.baseIncrement) + 8, 18))
  const estimatedBaseQuantity = request.baseQuantity ?? quantizeDown(
    divideDecimalDown(request.quoteNotional!, fillPrice, baseScale),
    options.productRules.baseIncrement,
  )
  const estimatedQuoteValue = request.quoteNotional ?? multiplyDecimal(estimatedBaseQuantity, fillPrice)
  const estimatedFees = multiplyDecimal(estimatedQuoteValue, options.feeRate)
  const estimatedTotalDebit = request.side === 'BUY'
    ? addDecimal(estimatedQuoteValue, estimatedFees)
    : null
  const estimatedNetCredit = request.side === 'SELL'
    ? subtractNonNegativeDecimal(estimatedQuoteValue, estimatedFees, 'estimatedNetCredit')
    : null
  const estimatedTotal = request.side === 'BUY' ? estimatedTotalDebit : estimatedNetCredit
  const expiresAt = resultExpiry(options)
  const warnings = Object.freeze(['execution_locked', 'local_estimate_not_exchange_guarantee'])

  const evidence = {
    exchange: 'BITGET',
    request,
    productRules: options.productRules,
    referencePrice: options.referencePrice,
    feeRate: options.feeRate,
    slippageBps: options.slippageBps,
    estimatedBaseQuantity,
    estimatedQuoteValue,
    estimatedFees,
    estimatedFillPrice: fillPrice,
    estimatedTotalDebit,
    estimatedNetCredit,
    expiresAt,
    warnings,
    executionAllowed: false,
  }
  const rawResponseHash = await canonicalHash(evidence)

  return Object.freeze({
    accepted: true,
    previewId: `bitget-local-${rawResponseHash.slice(0, 24)}`,
    estimatedTotal,
    estimatedFees,
    estimatedFillPrice: fillPrice,
    errors: Object.freeze([]),
    rawResponseHash,
    previewSource: 'LOCAL_LOCKED_ESTIMATE',
    executionAllowed: false,
    estimatedBaseQuantity,
    estimatedQuoteValue,
    estimatedTotalDebit,
    estimatedNetCredit,
    expiresAt,
    warnings,
  })
}

export class BitgetLockedPreviewAdapter implements FinancialMutationAdapter {
  private readonly options: BitgetLockedPreviewOptions

  constructor(options: BitgetLockedPreviewOptions) {
    this.options = options
  }

  previewOrder(request: OrderPreviewRequest): Promise<BitgetLockedPreviewResult> {
    return previewBitgetOrderLocked(this.options, request)
  }

  createOrder(): never {
    throw new CandidateExecutionLockedError('bitget.createOrder')
  }

  cancelOrder(): never {
    throw new CandidateExecutionLockedError('bitget.cancelOrder')
  }

  replaceOrder(): never {
    throw new CandidateExecutionLockedError('bitget.replaceOrder')
  }

  requestWithdrawal(): never {
    throw new CandidateExecutionLockedError('bitget.requestWithdrawal')
  }
}
