/**
 * Bitget UTA V3 read-only normalizer.
 *
 * Maps V3 API responses into the repo's exchange contracts. Implements
 * `ReadOnlyExchangeAdapter` from `worker/src/live/exchange-contracts.ts`.
 *
 * Step-1 scope notes:
 * - Balances come from GET /api/v3/account/assets (unified-margin account view).
 *   `normalizeUnifiedAccount` surfaces the unified-margin fields (total equity,
 *   effective equity, maintenance/initial margin, margin ratio, unrealised PnL)
 *   as a V3-specific snapshot — they are READ and reported here, not consumed
 *   for allocation. Wiring them into the risk engine is step 2; the risk engine
 *   is untouched by this module.
 * - Positions come from GET /api/v3/position/current-position and are surfaced
 *   as `BitgetV3PositionSnapshot` (a V3-local type, not a shared contract).
 * - `normalizeOrder` / `normalizeFill` intentionally throw: no V3 order or fill
 *   endpoints are allowlisted in step 1, so there is nothing honest to map.
 *   The capabilities object declares orderHistory/fills as false.
 */
import {
  ExchangeContractError,
  type ExchangeAccountBalance,
  type ExchangeCapabilities,
  type ExchangeFillSnapshot,
  type ExchangeOrderSnapshot,
  type ExchangeProduct,
  type ReadOnlyExchangeAdapter,
} from '../../../exchange-contracts.ts'
import {
  asDecimalString,
  compareDecimal,
  type DecimalString,
} from '../../../decimal.ts'
import { normalizeProductRules } from '../../../product-rules.ts'

export interface BitgetV3UnifiedAccountSnapshot {
  accountEquityUsd: DecimalString
  effectiveEquityUsd: DecimalString
  maintenanceMarginUsd: DecimalString
  initialMarginUsd: DecimalString
  marginRatio: DecimalString
  unrealisedPnlUsd: DecimalString
  balances: readonly ExchangeAccountBalance[]
  observedAt: string
}

export interface BitgetV3PositionSnapshot {
  productId: string
  category: string
  symbol: string
  side: 'long' | 'short'
  size: DecimalString
  entryPrice: DecimalString
  markPrice: DecimalString
  unrealisedPnl: DecimalString
  liquidationPrice: DecimalString | null
  marginMode: string
  leverage: DecimalString
  createdAt: string
  updatedAt: string
}

export const BITGET_V3_READ_ONLY_CAPABILITIES: ExchangeCapabilities = Object.freeze({
  exchange: 'BITGET',
  spot: true,
  accounts: true,
  products: true,
  orderPreview: false,
  createOrder: false,
  cancelOrder: false,
  replaceOrder: false,
  orderHistory: false,
  fills: false,
  userStream: false,
  deposits: false,
  withdrawals: false,
  clientOrderIds: false,
  sandbox: false,
  candidateExecutionEnabled: false,
  candidateWithdrawalsEnabled: false,
  observedAt: '2026-10-05T00:00:00.000Z',
})

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

const KNOWN_QUOTES = ['USDT', 'USDC', 'BTC', 'ETH', 'EUR', 'BRL']

function productId(symbol: unknown, baseCoin?: unknown, quoteCoin?: unknown): string {
  const base = optionalText(baseCoin)?.toUpperCase()
  const quote = optionalText(quoteCoin)?.toUpperCase()
  if (base && quote) return `${base}-${quote}`
  const normalized = text(symbol, 'symbol').toUpperCase()
  const matched = KNOWN_QUOTES.find((candidate) => normalized.endsWith(candidate))
  if (!matched || normalized.length <= matched.length) {
    throw new ExchangeContractError('symbol', 'cannot derive BASE-QUOTE product identifier')
  }
  return `${normalized.slice(0, -matched.length)}-${matched}`
}

function positionRows(value: unknown): readonly unknown[] {
  const data = unwrapData(value)
  const list = data.list
  if (!Array.isArray(list)) {
    throw new ExchangeContractError('data.list', 'must be an array')
  }
  return Object.freeze([...list])
}

export class BitgetV3ReadOnlyAdapter implements ReadOnlyExchangeAdapter {
  readonly capabilities = BITGET_V3_READ_ONLY_CAPABILITIES

  /**
   * Maps a single V3 account asset row
   * ({coin, available, locked, debt, balance, equity, usdValue})
   * into the shared balance contract. `held` maps the locked (frozen) amount.
   */
  normalizeAccount(input: unknown, observedAt: string): ExchangeAccountBalance {
    const data = record(input, 'asset')
    const asset = text(data.coin, 'coin').toUpperCase()
    const locked = optionalDecimal(data.locked, 'locked') ?? decimal('0', 'locked')
    return {
      accountId: `BITGET:UTA:${asset}`,
      asset,
      available: decimal(data.available ?? '0', 'available'),
      held: locked,
      active: true,
      ready: true,
      observedAt: timestamp(data.uTime ?? observedAt, 'observedAt'),
    }
  }

  /**
   * Maps the full GET /api/v3/account/assets payload into the unified-margin
   * account snapshot. Unified-margin fields are surfaced for observation and
   * step-2 risk-input design — they are not consumed for allocation here.
   */
  normalizeUnifiedAccount(input: unknown, observedAt: string): BitgetV3UnifiedAccountSnapshot {
    const data = unwrapData(input)
    const assets = data.assets
    if (!Array.isArray(assets)) {
      throw new ExchangeContractError('data.assets', 'must be an array')
    }
    const observed = timestamp(observedAt, 'observedAt')
    return {
      accountEquityUsd: decimal(data.accountEquity ?? '0', 'accountEquity'),
      effectiveEquityUsd: decimal(data.effEquity ?? '0', 'effEquity'),
      maintenanceMarginUsd: decimal(data.mmr ?? '0', 'mmr'),
      initialMarginUsd: decimal(data.imr ?? '0', 'imr'),
      marginRatio: decimal(data.mgnRatio ?? '0', 'mgnRatio'),
      unrealisedPnlUsd: decimal(data.unrealisedPnl ?? '0', 'unrealisedPnl'),
      balances: Object.freeze(assets.map((asset) => this.normalizeAccount(asset, observed))),
      observedAt: observed,
    }
  }

  /**
   * Maps a single GET /api/v3/market/instruments row into the shared product
   * contract. Feeds the step-2 product-normalization data source.
   */
  normalizeProduct(input: unknown, observedAt: string, expiresAt: string): ExchangeProduct {
    const data = record(input, 'instrument')
    const status = text(data.status, 'status').toLowerCase()
    const tradingEnabled = status === 'online'
    const baseIncrement = precisionIncrement(data.quantityPrecision, 'quantityPrecision')
    const quoteIncrement = precisionIncrement(
      data.quotePrecision ?? data.quantityPrecision,
      'quotePrecision',
    )
    const priceIncrement = precisionIncrement(data.pricePrecision, 'pricePrecision')
    const minimumBaseCandidate = optionalDecimal(data.minOrderQty, 'minOrderQty')
    const zero = decimal('0', 'zero')
    const minimumBaseSize =
      minimumBaseCandidate && compareDecimal(minimumBaseCandidate, zero) > 0
        ? minimumBaseCandidate
        : baseIncrement
    const maximumBaseCandidate = optionalDecimal(data.maxOrderQty, 'maxOrderQty')
    const maximumBaseSize =
      maximumBaseCandidate && compareDecimal(maximumBaseCandidate, minimumBaseSize) >= 0
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
      minimumQuoteSize: data.minOrderAmount,
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
      price: null,
      rules,
    }
  }

  /**
   * Maps a single GET /api/v3/position/current-position row into a V3-local
   * position snapshot. A liquidation price <= 0 means liquidation cannot occur
   * (per UTA docs) and normalizes to null.
   */
  normalizePosition(input: unknown): BitgetV3PositionSnapshot {
    const data = record(input, 'position')
    const side = text(data.posSide, 'posSide').toLowerCase()
    if (side !== 'long' && side !== 'short') {
      throw new ExchangeContractError('posSide', `unsupported value ${side}`)
    }
    const liquidationRaw = optionalDecimal(data.liquidationPrice, 'liquidationPrice')
    const zero = decimal('0', 'zero')
    return {
      productId: productId(data.symbol, data.baseCoin, data.quoteCoin),
      category: text(data.category ?? 'UNKNOWN', 'category'),
      symbol: text(data.symbol, 'symbol').toUpperCase(),
      side,
      size: decimal(data.total ?? '0', 'total'),
      entryPrice: decimal(data.avgPrice ?? '0', 'avgPrice'),
      markPrice: decimal(data.markPrice ?? '0', 'markPrice'),
      unrealisedPnl: decimal(data.unrealisedPnl ?? '0', 'unrealisedPnl'),
      liquidationPrice:
        liquidationRaw && compareDecimal(liquidationRaw, zero) > 0 ? liquidationRaw : null,
      marginMode: text(data.marginMode ?? 'crossed', 'marginMode'),
      leverage: decimal(data.leverage ?? '1', 'leverage'),
      createdAt: timestamp(data.createdTime ?? Date.now(), 'createdTime'),
      updatedAt: timestamp(data.updatedTime ?? Date.now(), 'updatedTime'),
    }
  }

  normalizePositionList(input: unknown): readonly BitgetV3PositionSnapshot[] {
    return Object.freeze(positionRows(input).map((row) => this.normalizePosition(row)))
  }

  normalizeOrder(_input: unknown): ExchangeOrderSnapshot {
    throw new ExchangeContractError(
      'order',
      'order normalization is not supported by the V3 read-only module: no V3 order endpoints are allowlisted in step 1',
    )
  }

  normalizeFill(_input: unknown): ExchangeFillSnapshot {
    throw new ExchangeContractError(
      'fill',
      'fill normalization is not supported by the V3 read-only module: no V3 fill endpoints are allowlisted in step 1',
    )
  }
}
