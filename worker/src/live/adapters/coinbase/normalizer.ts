import {
  ExchangeContractError,
  type ExchangeAccountBalance,
  type ExchangeCapabilities,
  type ExchangeFillSnapshot,
  type ExchangeOrderSnapshot,
  type ExchangeProduct,
  type ReadOnlyExchangeAdapter,
} from '../../exchange-contracts.ts'
import type { OrderSide, OrderType } from '../../domain.ts'
import {
  asDecimalString,
  compareDecimal,
  subtractNonNegativeDecimal,
  type DecimalString,
} from '../../decimal.ts'
import { normalizeProductRules } from '../../product-rules.ts'

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ExchangeContractError(field, 'must be an object')
  }
  return value as Record<string, unknown>
}

function unwrap(value: unknown, key: string): Record<string, unknown> {
  const root = record(value, 'response')
  return key in root ? record(root[key], key) : root
}

function text(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized) throw new ExchangeContractError(field, 'is required')
  return normalized
}

function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function timestamp(value: unknown, field: string): string {
  const normalized = text(value, field)
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) {
    throw new ExchangeContractError(field, 'must be a valid ISO-8601 timestamp')
  }
  return new Date(parsed).toISOString()
}

function optionalTimestamp(value: unknown): string | null {
  const normalized = optionalText(value)
  if (!normalized || !Number.isFinite(Date.parse(normalized))) return null
  return new Date(normalized).toISOString()
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true'
}

function decimal(value: unknown, field: string): DecimalString {
  try {
    return asDecimalString(value, field)
  } catch (error) {
    throw new ExchangeContractError(field, String(error))
  }
}

function optionalDecimal(value: unknown, field: string): DecimalString | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  return decimal(value, field)
}

function side(value: unknown): OrderSide {
  const normalized = text(value, 'side').toUpperCase()
  if (normalized !== 'BUY' && normalized !== 'SELL') {
    throw new ExchangeContractError('side', `unsupported value ${normalized}`)
  }
  return normalized
}

function orderType(value: unknown, configuration: Record<string, unknown>): OrderType {
  const explicit = optionalText(value)?.toUpperCase()
  if (explicit && ['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'].includes(explicit)) {
    return explicit as OrderType
  }

  const keys = Object.keys(configuration)
  if (keys.some((key) => key.startsWith('stop_limit_'))) return 'STOP_LIMIT'
  if (keys.some((key) => key.includes('limit'))) return 'LIMIT'
  if (keys.some((key) => key.includes('market'))) return 'MARKET'
  throw new ExchangeContractError('order_type', 'cannot be derived from response')
}

function productAssets(productId: string): [string, string] {
  const parts = productId.split('-')
  if (parts.length !== 2 || parts.some((part) => !part)) {
    throw new ExchangeContractError('product_id', 'must use BASE-QUOTE format')
  }
  return [parts[0], parts[1]]
}

function moneyValue(value: unknown, field: string): DecimalString {
  const source = record(value, field)
  return decimal(source.value, `${field}.value`)
}

function configurationAmounts(configuration: Record<string, unknown>): {
  base: DecimalString | null
  quote: DecimalString | null
} {
  for (const value of Object.values(configuration)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const config = value as Record<string, unknown>
    const base = optionalDecimal(config.base_size, 'order_configuration.base_size')
    const quote = optionalDecimal(config.quote_size, 'order_configuration.quote_size')
    if (base !== null || quote !== null) return { base, quote }
  }
  return { base: null, quote: null }
}

function supportedOrderTypes(product: Record<string, unknown>): readonly OrderType[] {
  if (bool(product.trading_disabled) || bool(product.is_disabled)) return []
  if (bool(product.limit_only)) return ['LIMIT']
  return ['MARKET', 'LIMIT']
}

export class CoinbaseReadOnlyNormalizer implements ReadOnlyExchangeAdapter {
  readonly capabilities: ExchangeCapabilities

  constructor(observedAt = new Date().toISOString()) {
    this.capabilities = {
      exchange: 'coinbase-advanced-trade',
      spot: true,
      accounts: true,
      products: true,
      orderPreview: true,
      createOrder: true,
      cancelOrder: true,
      replaceOrder: true,
      orderHistory: true,
      fills: true,
      userStream: true,
      deposits: false,
      withdrawals: false,
      clientOrderIds: true,
      sandbox: true,
      candidateExecutionEnabled: false,
      candidateWithdrawalsEnabled: false,
      observedAt: timestamp(observedAt, 'observedAt'),
    }
  }

  normalizeAccount(input: unknown, observedAt: string): ExchangeAccountBalance {
    const account = unwrap(input, 'account')
    const asset = text(account.currency, 'currency').toUpperCase()
    const availableObject = record(account.available_balance, 'available_balance')
    const holdObject = record(account.hold, 'hold')

    if (text(availableObject.currency, 'available_balance.currency').toUpperCase() !== asset) {
      throw new ExchangeContractError('available_balance.currency', 'does not match account currency')
    }
    if (text(holdObject.currency, 'hold.currency').toUpperCase() !== asset) {
      throw new ExchangeContractError('hold.currency', 'does not match account currency')
    }

    return {
      accountId: text(account.uuid, 'uuid'),
      asset,
      available: moneyValue(account.available_balance, 'available_balance'),
      held: moneyValue(account.hold, 'hold'),
      active: bool(account.active),
      ready: bool(account.ready),
      observedAt: timestamp(observedAt, 'observedAt'),
    }
  }

  normalizeProduct(input: unknown, observedAt: string, expiresAt: string): ExchangeProduct {
    const product = unwrap(input, 'product')
    const productId = text(product.product_id, 'product_id').toUpperCase()
    const [baseAsset, quoteAsset] = productAssets(productId)
    const tradingEnabled = !bool(product.trading_disabled) && !bool(product.is_disabled)
    const rules = normalizeProductRules({
      productId,
      baseAsset,
      quoteAsset,
      baseIncrement: product.base_increment,
      quoteIncrement: product.quote_increment,
      priceIncrement: product.price_increment ?? product.quote_increment,
      minimumBaseSize: product.base_min_size,
      maximumBaseSize: product.base_max_size,
      minimumQuoteSize: product.quote_min_size,
      tradingEnabled,
      supportedOrderTypes: supportedOrderTypes(product),
      observedAt,
      expiresAt,
    })

    return {
      productId,
      baseAsset,
      quoteAsset,
      status: String(product.status ?? '').trim().toUpperCase() || 'UNKNOWN',
      tradingEnabled,
      cancelOnly: bool(product.cancel_only),
      limitOnly: bool(product.limit_only),
      postOnly: bool(product.post_only),
      price: optionalDecimal(product.price, 'price'),
      rules,
    }
  }

  normalizeOrder(input: unknown): ExchangeOrderSnapshot {
    const order = unwrap(input, 'order')
    const configuration = record(order.order_configuration ?? {}, 'order_configuration')
    const amounts = configurationAmounts(configuration)
    const filledBaseQuantity = decimal(order.filled_size ?? '0', 'filled_size')
    const remainingBaseQuantity = amounts.base === null
      ? null
      : compareDecimal(filledBaseQuantity, amounts.base) <= 0
        ? subtractNonNegativeDecimal(amounts.base, filledBaseQuantity, 'remainingBaseQuantity')
        : (() => {
            throw new ExchangeContractError('filled_size', 'exceeds requested base quantity')
          })()
    const createdAt = timestamp(order.created_time, 'created_time')
    const updatedAt = optionalTimestamp(order.last_update_time)
      ?? optionalTimestamp(order.last_fill_time)
      ?? createdAt

    return {
      exchangeOrderId: text(order.order_id, 'order_id'),
      clientOrderId: optionalText(order.client_order_id),
      productId: text(order.product_id, 'product_id').toUpperCase(),
      side: side(order.side),
      orderType: orderType(order.order_type, configuration),
      rawStatus: text(order.status, 'status').toUpperCase(),
      requestedBaseQuantity: amounts.base,
      requestedQuoteNotional: amounts.quote,
      filledBaseQuantity,
      filledQuoteValue: optionalDecimal(order.filled_value, 'filled_value'),
      remainingBaseQuantity,
      averageFillPrice: optionalDecimal(order.average_filled_price, 'average_filled_price'),
      totalFees: optionalDecimal(order.total_fees ?? order.fee, 'total_fees'),
      pendingCancel: bool(order.pending_cancel),
      settled: bool(order.settled),
      createdAt,
      updatedAt,
    }
  }

  normalizeFill(input: unknown): ExchangeFillSnapshot {
    const fill = unwrap(input, 'fill')
    const productId = text(fill.product_id, 'product_id').toUpperCase()
    const commissionAsset = optionalText(fill.commission_currency ?? fill.commission_asset)?.toUpperCase() ?? null

    return {
      fillId: text(fill.entry_id, 'entry_id'),
      tradeId: text(fill.trade_id, 'trade_id'),
      exchangeOrderId: text(fill.order_id, 'order_id'),
      productId,
      side: side(fill.side),
      price: decimal(fill.price, 'price'),
      baseSize: decimal(fill.size, 'size'),
      commission: decimal(fill.commission ?? '0', 'commission'),
      commissionAsset,
      tradeTime: timestamp(fill.trade_time, 'trade_time'),
      sequenceTimestamp: timestamp(
        fill.sequence_timestamp ?? fill.trade_time,
        'sequence_timestamp',
      ),
    }
  }
}
