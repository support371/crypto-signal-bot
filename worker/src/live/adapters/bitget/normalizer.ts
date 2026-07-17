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
  addDecimal,
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

function unwrapData(value: unknown): Record<string, unknown> {
  const root = record(value, 'response')
  return 'data' in root ? record(root.data, 'data') : root
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

function absoluteDecimal(value: unknown, field: string): DecimalString {
  const normalized = String(value ?? '').trim()
  return decimal(normalized.startsWith('-') ? normalized.slice(1) : normalized || '0', field)
}

function precisionIncrement(value: unknown, field: string): DecimalString {
  const normalized = text(value, field)
  if (!/^\d{1,3}$/.test(normalized)) {
    throw new ExchangeContractError(field, 'must be an integer precision from 0 to 100')
  }
  const precision = Number(normalized)
  if (!Number.isInteger(precision) || precision < 0 || precision > 100) {
    throw new ExchangeContractError(field, 'must be an integer precision from 0 to 100')
  }
  return decimal(precision === 0 ? '1' : `0.${'0'.repeat(precision - 1)}1`, field)
}

function timestamp(value: unknown, field: string): string {
  const raw = text(value, field)
  if (/^\d{10,13}$/.test(raw)) {
    const milliseconds = raw.length === 10 ? Number(raw) * 1000 : Number(raw)
    if (Number.isFinite(milliseconds)) return new Date(milliseconds).toISOString()
  }
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) {
    throw new ExchangeContractError(field, 'must be Unix seconds, Unix milliseconds, or ISO-8601')
  }
  return new Date(parsed).toISOString()
}

function side(value: unknown): OrderSide {
  const normalized = text(value, 'side').toUpperCase()
  if (normalized !== 'BUY' && normalized !== 'SELL') {
    throw new ExchangeContractError('side', `unsupported value ${normalized}`)
  }
  return normalized
}

function orderType(value: unknown): OrderType {
  const normalized = text(value, 'orderType').toUpperCase()
  if (normalized === 'MARKET' || normalized === 'LIMIT') return normalized
  throw new ExchangeContractError('orderType', `unsupported value ${normalized}`)
}

function productId(symbol: unknown, baseCoin?: unknown, quoteCoin?: unknown): string {
  const base = optionalText(baseCoin)?.toUpperCase()
  const quote = optionalText(quoteCoin)?.toUpperCase()
  if (base && quote) return `${base}-${quote}`

  const normalized = text(symbol, 'symbol').toUpperCase()
  const knownQuotes = ['USDT', 'USDC', 'BTC', 'ETH', 'EUR', 'BRL']
  const matched = knownQuotes.find((candidate) => normalized.endsWith(candidate))
  if (!matched || normalized.length <= matched.length) {
    throw new ExchangeContractError('symbol', 'cannot derive BASE-QUOTE product identifier')
  }
  return `${normalized.slice(0, -matched.length)}-${matched}`
}

function parseFeeDetail(value: unknown): { amount: DecimalString | null; asset: string | null } {
  if (value === null || value === undefined || value === '') return { amount: null, asset: null }
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      return { amount: null, asset: null }
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { amount: null, asset: null }
  }
  const detail = parsed as Record<string, unknown>
  if ('totalFee' in detail) {
    return {
      amount: absoluteDecimal(detail.totalFee, 'feeDetail.totalFee'),
      asset: optionalText(detail.feeCoin)?.toUpperCase() ?? null,
    }
  }
  if ('newFees' in detail && detail.newFees && typeof detail.newFees === 'object') {
    const fees = detail.newFees as Record<string, unknown>
    return {
      amount: fees.t === undefined ? null : absoluteDecimal(fees.t, 'feeDetail.newFees.t'),
      asset: null,
    }
  }
  return { amount: null, asset: null }
}

function normalizedStatus(value: unknown): string {
  return text(value, 'status').trim().toLowerCase()
}

export const BITGET_READ_ONLY_CAPABILITIES: ExchangeCapabilities = Object.freeze({
  exchange: 'BITGET',
  spot: true,
  accounts: true,
  products: true,
  orderPreview: false,
  createOrder: false,
  cancelOrder: false,
  replaceOrder: false,
  orderHistory: true,
  fills: true,
  userStream: false,
  deposits: false,
  withdrawals: false,
  clientOrderIds: true,
  sandbox: false,
  candidateExecutionEnabled: false,
  candidateWithdrawalsEnabled: false,
  observedAt: '2026-07-17T00:00:00.000Z',
})

export class BitgetReadOnlyAdapter implements ReadOnlyExchangeAdapter {
  readonly capabilities = BITGET_READ_ONLY_CAPABILITIES

  normalizeAccount(input: unknown, observedAt: string): ExchangeAccountBalance {
    const data = unwrapData(input)
    const asset = text(data.coin, 'coin').toUpperCase()
    const frozen = optionalDecimal(data.frozen, 'frozen') ?? decimal('0', 'frozen')
    const locked = optionalDecimal(data.locked, 'locked') ?? decimal('0', 'locked')
    return {
      accountId: `BITGET:SPOT:${asset}`,
      asset,
      available: decimal(data.available ?? '0', 'available'),
      held: addDecimal(frozen, locked),
      active: true,
      ready: true,
      observedAt: timestamp(data.uTime ?? observedAt, 'observedAt'),
    }
  }

  normalizeProduct(input: unknown, observedAt: string, expiresAt: string): ExchangeProduct {
    const data = unwrapData(input)
    const status = text(data.status, 'status').toLowerCase()
    const tradingEnabled = status === 'online'
    const baseIncrement = precisionIncrement(data.quantityPrecision, 'quantityPrecision')
    const quoteIncrement = precisionIncrement(data.quotePrecision, 'quotePrecision')
    const priceIncrement = precisionIncrement(data.pricePrecision, 'pricePrecision')
    const minimumBaseCandidate = optionalDecimal(data.minTradeAmount, 'minTradeAmount')
    const minimumBaseSize = minimumBaseCandidate && compareDecimal(minimumBaseCandidate, decimal('0')) > 0
      ? minimumBaseCandidate
      : baseIncrement
    const maximumBaseCandidate = optionalDecimal(data.maxTradeAmount, 'maxTradeAmount')
    const maximumBaseSize = maximumBaseCandidate && compareDecimal(maximumBaseCandidate, minimumBaseSize) >= 0
      ? maximumBaseCandidate
      : null

    const rules = normalizeProductRules({
      productId: productId(data.symbol, data.baseCoin, data.quoteCoin),
      baseAsset: data.baseCoin,
      quoteAsset: data.quoteCoin,
      baseIncrement,
      quoteIncrement,
      priceIncrement,
      minimumBaseSize,
      maximumBaseSize,
      minimumQuoteSize: data.minTradeUSDT,
      tradingEnabled,
      supportedOrderTypes: tradingEnabled ? ['MARKET', 'LIMIT'] : [],
      observedAt,
      expiresAt,
    })

    return {
      productId: rules.productId,
      baseAsset: rules.baseAsset,
      quoteAsset: rules.quoteAsset,
      status,
      tradingEnabled,
      cancelOnly: false,
      limitOnly: false,
      postOnly: false,
      price: optionalDecimal(data.lastPr ?? data.price, 'price'),
      rules,
    }
  }

  normalizeOrder(input: unknown): ExchangeOrderSnapshot {
    const data = unwrapData(input)
    const normalizedSide = side(data.side)
    const normalizedType = orderType(data.orderType)
    const requested = decimal(data.size, 'size')
    const requestedBaseQuantity = normalizedType === 'LIMIT' || normalizedSide === 'SELL'
      ? requested
      : null
    const requestedQuoteNotional = normalizedType === 'MARKET' && normalizedSide === 'BUY'
      ? requested
      : null
    const filledBaseQuantity = decimal(data.baseVolume ?? '0', 'baseVolume')
    const remainingBaseQuantity = requestedBaseQuantity === null
      ? null
      : subtractNonNegativeDecimal(requestedBaseQuantity, filledBaseQuantity, 'remainingBaseQuantity')
    const status = normalizedStatus(data.status)
    const fee = parseFeeDetail(data.feeDetail)

    return {
      exchangeOrderId: optionalText(data.orderId),
      clientOrderId: optionalText(data.clientOid),
      productId: productId(data.symbol, data.baseCoin, data.quoteCoin),
      side: normalizedSide,
      orderType: normalizedType,
      rawStatus: status,
      requestedBaseQuantity,
      requestedQuoteNotional,
      filledBaseQuantity,
      filledQuoteValue: optionalDecimal(data.quoteVolume, 'quoteVolume'),
      remainingBaseQuantity,
      averageFillPrice: optionalDecimal(data.priceAvg ?? data.basePrice, 'averageFillPrice'),
      totalFees: fee.amount,
      pendingCancel: status === 'canceling' || status === 'cancelling',
      settled: status === 'filled' || status === 'cancelled' || status === 'canceled',
      createdAt: timestamp(data.cTime, 'cTime'),
      updatedAt: timestamp(data.uTime ?? data.cTime, 'uTime'),
    }
  }

  normalizeFill(input: unknown): ExchangeFillSnapshot {
    const data = unwrapData(input)
    const fee = parseFeeDetail(data.feeDetail)
    const tradeTime = timestamp(data.cTime, 'cTime')
    return {
      fillId: text(data.tradeId, 'tradeId'),
      tradeId: text(data.tradeId, 'tradeId'),
      exchangeOrderId: text(data.orderId, 'orderId'),
      productId: productId(data.symbol, data.baseCoin, data.quoteCoin),
      side: side(data.side),
      price: decimal(data.priceAvg ?? data.price, 'price'),
      baseSize: decimal(data.size ?? data.baseVolume, 'size'),
      commission: fee.amount ?? decimal('0', 'commission'),
      commissionAsset: fee.asset,
      tradeTime,
      sequenceTimestamp: timestamp(data.uTime ?? data.cTime, 'uTime'),
    }
  }
}
