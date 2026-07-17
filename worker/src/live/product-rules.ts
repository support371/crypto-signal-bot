import type { OrderIntent, OrderType, ProductRules } from './domain.ts'
import {
  asDecimalString,
  assertPositiveDecimal,
  compareDecimal,
  isIncrementAligned,
  type DecimalString,
} from './decimal.ts'

const ORDER_TYPES = new Set<OrderType>(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'])

export interface RawProductRules {
  productId: unknown
  baseAsset: unknown
  quoteAsset: unknown
  baseIncrement: unknown
  quoteIncrement: unknown
  priceIncrement: unknown
  minimumBaseSize: unknown
  maximumBaseSize?: unknown
  minimumQuoteSize: unknown
  tradingEnabled: unknown
  supportedOrderTypes: unknown
  observedAt: unknown
  expiresAt: unknown
}

export interface ValidatedOrderAmounts {
  basis: 'BASE' | 'QUOTE'
  baseQuantity: DecimalString | null
  quoteNotional: DecimalString | null
  limitPrice: DecimalString | null
  stopPrice: DecimalString | null
}

export interface ProductValidationResult {
  accepted: boolean
  reasons: readonly string[]
  amounts: ValidatedOrderAmounts | null
}

function requiredText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim().toUpperCase()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function isoTimestamp(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${field} must be a valid ISO-8601 timestamp`)
  }
  return new Date(normalized).toISOString()
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'
}

function orderTypes(value: unknown): readonly OrderType[] {
  if (!Array.isArray(value)) throw new TypeError('supportedOrderTypes must be an array')
  const normalized = Array.from(new Set(value
    .map((item) => String(item).trim().toUpperCase())
    .filter((item): item is OrderType => ORDER_TYPES.has(item as OrderType))))
  if (normalized.length === 0) {
    throw new TypeError('supportedOrderTypes must contain at least one supported type')
  }
  return normalized
}

function optionalPositiveDecimal(value: unknown, field: string): DecimalString | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  return assertPositiveDecimal(asDecimalString(value, field), field)
}

export function normalizeProductRules(raw: RawProductRules): ProductRules {
  const observedAt = isoTimestamp(raw.observedAt, 'observedAt')
  const expiresAt = isoTimestamp(raw.expiresAt, 'expiresAt')
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) {
    throw new RangeError('expiresAt must be later than observedAt')
  }

  return {
    productId: requiredText(raw.productId, 'productId'),
    baseAsset: requiredText(raw.baseAsset, 'baseAsset'),
    quoteAsset: requiredText(raw.quoteAsset, 'quoteAsset'),
    baseIncrement: assertPositiveDecimal(
      asDecimalString(raw.baseIncrement, 'baseIncrement'),
      'baseIncrement',
    ),
    quoteIncrement: assertPositiveDecimal(
      asDecimalString(raw.quoteIncrement, 'quoteIncrement'),
      'quoteIncrement',
    ),
    priceIncrement: assertPositiveDecimal(
      asDecimalString(raw.priceIncrement, 'priceIncrement'),
      'priceIncrement',
    ),
    minimumBaseSize: assertPositiveDecimal(
      asDecimalString(raw.minimumBaseSize, 'minimumBaseSize'),
      'minimumBaseSize',
    ),
    maximumBaseSize: optionalPositiveDecimal(raw.maximumBaseSize, 'maximumBaseSize'),
    minimumQuoteSize: assertPositiveDecimal(
      asDecimalString(raw.minimumQuoteSize, 'minimumQuoteSize'),
      'minimumQuoteSize',
    ),
    tradingEnabled: booleanValue(raw.tradingEnabled),
    supportedOrderTypes: orderTypes(raw.supportedOrderTypes),
    observedAt,
    expiresAt,
  }
}

function validateAligned(
  value: DecimalString | null,
  increment: DecimalString,
  reason: string,
  reasons: string[],
): void {
  if (value !== null && !isIncrementAligned(value, increment)) reasons.push(reason)
}

export function validateOrderAgainstProductRules(
  intent: OrderIntent,
  rules: ProductRules,
  now = new Date(),
): ProductValidationResult {
  const reasons: string[] = []
  const productId = intent.productId.trim().toUpperCase()

  if (productId !== rules.productId) reasons.push('product_rule_mismatch')
  if (!rules.tradingEnabled) reasons.push('product_trading_disabled')
  if (!rules.supportedOrderTypes.includes(intent.orderType)) reasons.push('order_type_not_supported')

  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) reasons.push('validation_time_invalid')
  if (Date.parse(rules.observedAt) > nowMs) reasons.push('product_rules_observed_in_future')
  if (Date.parse(rules.expiresAt) <= nowMs) reasons.push('product_rules_stale')

  const hasBase = intent.baseQuantity !== null
  const hasQuote = intent.quoteNotional !== null
  if (hasBase === hasQuote) reasons.push('exactly_one_order_size_basis_required')

  if (intent.baseQuantity !== null) {
    if (!isIncrementAligned(intent.baseQuantity, rules.baseIncrement)) {
      reasons.push('base_quantity_increment_mismatch')
    }
    if (compareDecimal(intent.baseQuantity, rules.minimumBaseSize) < 0) {
      reasons.push('base_quantity_below_minimum')
    }
    if (
      rules.maximumBaseSize !== null
      && compareDecimal(intent.baseQuantity, rules.maximumBaseSize) > 0
    ) {
      reasons.push('base_quantity_above_maximum')
    }
  }

  if (intent.quoteNotional !== null) {
    if (!isIncrementAligned(intent.quoteNotional, rules.quoteIncrement)) {
      reasons.push('quote_notional_increment_mismatch')
    }
    if (compareDecimal(intent.quoteNotional, rules.minimumQuoteSize) < 0) {
      reasons.push('quote_notional_below_minimum')
    }
  }

  const limitRequired = intent.orderType === 'LIMIT' || intent.orderType === 'STOP_LIMIT'
  const stopRequired = intent.orderType === 'STOP' || intent.orderType === 'STOP_LIMIT'
  if (limitRequired && intent.limitPrice === null) reasons.push('limit_price_required')
  if (!limitRequired && intent.limitPrice !== null) reasons.push('limit_price_not_allowed')
  if (stopRequired && intent.stopPrice === null) reasons.push('stop_price_required')
  if (!stopRequired && intent.stopPrice !== null) reasons.push('stop_price_not_allowed')

  validateAligned(
    intent.limitPrice,
    rules.priceIncrement,
    'limit_price_increment_mismatch',
    reasons,
  )
  validateAligned(
    intent.stopPrice,
    rules.priceIncrement,
    'stop_price_increment_mismatch',
    reasons,
  )

  return {
    accepted: reasons.length === 0,
    reasons,
    amounts: reasons.length === 0
      ? {
          basis: hasBase ? 'BASE' : 'QUOTE',
          baseQuantity: intent.baseQuantity,
          quoteNotional: intent.quoteNotional,
          limitPrice: intent.limitPrice,
          stopPrice: intent.stopPrice,
        }
      : null,
  }
}
