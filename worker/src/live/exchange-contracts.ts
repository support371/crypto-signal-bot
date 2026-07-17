import type {
  OrderSide,
  OrderType,
  ProductRules,
} from './domain.ts'
import type { DecimalString } from './decimal.ts'

export interface ExchangeCapabilities {
  exchange: string
  spot: boolean
  accounts: boolean
  products: boolean
  orderPreview: boolean
  createOrder: boolean
  cancelOrder: boolean
  replaceOrder: boolean
  orderHistory: boolean
  fills: boolean
  userStream: boolean
  deposits: boolean
  withdrawals: boolean
  clientOrderIds: boolean
  sandbox: boolean
  candidateExecutionEnabled: false
  candidateWithdrawalsEnabled: false
  observedAt: string
}

export interface ExchangeAccountBalance {
  accountId: string
  asset: string
  available: DecimalString
  held: DecimalString
  active: boolean
  ready: boolean
  observedAt: string
}

export interface ExchangeProduct {
  productId: string
  baseAsset: string
  quoteAsset: string
  status: string
  tradingEnabled: boolean
  cancelOnly: boolean
  limitOnly: boolean
  postOnly: boolean
  price: DecimalString | null
  rules: ProductRules
}

export interface ExchangeOrderSnapshot {
  exchangeOrderId: string | null
  clientOrderId: string | null
  productId: string
  side: OrderSide
  orderType: OrderType
  rawStatus: string
  requestedBaseQuantity: DecimalString | null
  requestedQuoteNotional: DecimalString | null
  filledBaseQuantity: DecimalString
  filledQuoteValue: DecimalString | null
  remainingBaseQuantity: DecimalString | null
  averageFillPrice: DecimalString | null
  totalFees: DecimalString | null
  pendingCancel: boolean
  settled: boolean
  createdAt: string
  updatedAt: string
}

export interface ExchangeFillSnapshot {
  fillId: string
  tradeId: string
  exchangeOrderId: string
  productId: string
  side: OrderSide
  price: DecimalString
  baseSize: DecimalString
  commission: DecimalString
  commissionAsset: string | null
  tradeTime: string
  sequenceTimestamp: string
}

export interface OrderPreviewRequest {
  productId: string
  side: OrderSide
  orderType: OrderType
  baseQuantity: DecimalString | null
  quoteNotional: DecimalString | null
  limitPrice: DecimalString | null
  stopPrice: DecimalString | null
}

export interface OrderPreviewResult {
  accepted: boolean
  previewId: string | null
  estimatedTotal: DecimalString | null
  estimatedFees: DecimalString | null
  estimatedFillPrice: DecimalString | null
  errors: readonly string[]
  rawResponseHash: string
}

export interface ReadOnlyExchangeAdapter {
  readonly capabilities: ExchangeCapabilities
  normalizeAccount(input: unknown, observedAt: string): ExchangeAccountBalance
  normalizeProduct(input: unknown, observedAt: string, expiresAt: string): ExchangeProduct
  normalizeOrder(input: unknown): ExchangeOrderSnapshot
  normalizeFill(input: unknown): ExchangeFillSnapshot
}

/**
 * Deliberately separate from read-only normalization. No implementation is
 * provided by the disabled live-candidate branch.
 */
export interface FinancialMutationAdapter {
  previewOrder(request: OrderPreviewRequest): Promise<OrderPreviewResult>
  createOrder(): never
  cancelOrder(): never
  replaceOrder(): never
  requestWithdrawal(): never
}

export class ExchangeContractError extends Error {
  readonly field: string

  constructor(field: string, message: string) {
    super(`${field}: ${message}`)
    this.name = 'ExchangeContractError'
    this.field = field
  }
}

export class CandidateExecutionLockedError extends Error {
  constructor(operation: string) {
    super(`Candidate exchange operation is execution-locked: ${operation}`)
    this.name = 'CandidateExecutionLockedError'
  }
}
