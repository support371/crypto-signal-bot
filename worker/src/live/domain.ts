import type { DecimalString } from './decimal'

export {
  addDecimal,
  asDecimalString,
  asSignedDecimalString,
  assertPositiveDecimal,
  compareDecimal,
  isIncrementAligned,
  isPositiveDecimal,
  multiplyDecimal,
  quantizeDown,
  subtractDecimal,
  sumDecimals,
} from './decimal'
export type { DecimalString, SignedDecimalString } from './decimal'

export type TradingEnvironment = 'paper' | 'shadow' | 'testnet' | 'live-candidate' | 'live'
export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT'

export type OrderState =
  | 'REQUESTED'
  | 'VALIDATING'
  | 'VALIDATED'
  | 'RISK_REJECTED'
  | 'RISK_APPROVED'
  | 'RESERVING'
  | 'RESERVED'
  | 'PREVIEWING'
  | 'PREVIEW_REJECTED'
  | 'SUBMITTING'
  | 'SUBMITTED'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_REQUESTED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FAILED'
  | 'RECOVERY_REQUIRED'
  | 'SETTLED'

export interface ProductRules {
  productId: string
  baseAsset: string
  quoteAsset: string
  baseIncrement: DecimalString
  quoteIncrement: DecimalString
  priceIncrement: DecimalString
  minimumBaseSize: DecimalString
  maximumBaseSize: DecimalString | null
  minimumQuoteSize: DecimalString
  tradingEnabled: boolean
  supportedOrderTypes: readonly OrderType[]
  observedAt: string
  expiresAt: string
}

export interface OrderIntent {
  intentId: string
  idempotencyKey: string
  correlationId: string
  exchangeAccountId: string
  productId: string
  side: OrderSide
  orderType: OrderType
  baseQuantity: DecimalString | null
  quoteNotional: DecimalString | null
  limitPrice: DecimalString | null
  stopPrice: DecimalString | null
  strategyId: string | null
  requestedBy: string
  requestedAt: string
}

export interface RiskRuleResult {
  rule: string
  passed: boolean
  reason: string | null
  observedValue: DecimalString | string | boolean | null
  limitValue: DecimalString | string | boolean | null
}

export interface RiskDecision {
  decisionId: string
  approved: boolean
  rules: readonly RiskRuleResult[]
  configurationVersion: string
  decidedAt: string
}

export interface ExchangeOrder {
  internalOrderId: string
  clientOrderId: string
  exchangeOrderId: string | null
  exchangeAccountId: string
  productId: string
  side: OrderSide
  orderType: OrderType
  state: OrderState
  requestedQuantity: DecimalString
  filledQuantity: DecimalString
  remainingQuantity: DecimalString
  averageFillPrice: DecimalString | null
  feeAmount: DecimalString | null
  feeAsset: string | null
  createdAt: string
  updatedAt: string
}

export interface OrderEvent {
  eventId: string
  orderId: string
  previousState: OrderState | null
  nextState: OrderState
  source: 'api' | 'exchange-rest' | 'exchange-websocket' | 'reconciliation' | 'operator'
  sourceEventId: string | null
  actorId: string | null
  correlationId: string
  releaseId: string | null
  configurationVersion: string
  occurredAt: string
  payloadHash: string
  previousAuditHash: string | null
  auditHash: string
}

export interface ReleaseAuthorization {
  releaseId: string
  gitSha: string
  workerDeploymentId: string
  frontendDeploymentId: string
  schemaVersion: string
  exchange: string
  accountRefHash: string
  allowedProducts: readonly string[]
  maxOrderNotional: DecimalString
  maxDailyNotional: DecimalString
  startsAt: string
  expiresAt: string
  status: 'PENDING' | 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  securityReviewRef: string
  complianceReviewRef: string
}

export interface LiveReadinessReport {
  liveReady: boolean
  withdrawalsReady: false
  environment: 'live-candidate'
  reasons: readonly string[]
  checks: Readonly<Record<string, boolean>>
  releaseId: string | null
  gitSha: string
  evaluatedAt: string
}
