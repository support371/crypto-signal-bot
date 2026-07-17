import { canonicalHash } from './canonical-json.ts'
import {
  addSignedDecimal,
  asDecimalString,
  asSignedDecimalString,
  compareDecimal,
  compareSignedDecimal,
  decimalScale,
  divideDecimalDown,
  isNegativeSignedDecimal,
  multiplyDecimal,
  subtractDecimal,
  sumDecimals,
  sumSignedDecimals,
  type DecimalString,
  type SignedDecimalString,
} from './decimal.ts'

export interface AccountingReconciliationLot {
  lotId: string
  remainingQuantity: DecimalString
  remainingCostQuote: DecimalString
}

export interface AccountingReconciliationPosition {
  quantity: DecimalString
  totalCostBasisQuote: DecimalString
  averageEntryPrice: DecimalString | null
  cumulativeRealizedPnlQuote: SignedDecimalString
  status: 'OPEN' | 'CLOSED'
}

export interface FillAccountingReconciliationInput {
  reconciliationId: string
  exchangeName: 'BTCC' | 'BITGET'
  exchangeAccountId: string
  productId: string
  baseAsset: string
  quoteAsset: string
  position: AccountingReconciliationPosition
  lots: readonly AccountingReconciliationLot[]
  realizedPnlEvents: readonly SignedDecimalString[]
  ledgerBaseInventoryBalance: SignedDecimalString
  exchangeBaseBalance: DecimalString | null
  currentPrice: DecimalString | null
  observedAt: string
}

export interface FillAccountingReconciliationResult {
  reconciliationId: string
  status: 'CLEAR' | 'HALT_FOR_REVIEW'
  reasons: readonly string[]
  reconstructedQuantity: DecimalString
  reconstructedCostBasisQuote: DecimalString
  reconstructedAverageEntryPrice: DecimalString | null
  reconstructedRealizedPnlQuote: SignedDecimalString
  ledgerBaseInventoryBalance: SignedDecimalString
  exchangeBaseBalance: DecimalString | null
  currentPrice: DecimalString | null
  marketValueQuote: DecimalString | null
  unrealizedPnlQuote: SignedDecimalString | null
  reconciliationHash: string
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

const ZERO = asDecimalString('0')
const SIGNED_ZERO = asSignedDecimalString('0')
const COST_SCALE = 36

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function averageEntryPrice(
  cost: DecimalString,
  quantity: DecimalString,
): DecimalString | null {
  if (compareDecimal(quantity, ZERO) === 0) return null
  return divideDecimalDown(
    cost,
    quantity,
    Math.min(COST_SCALE, Math.max(18, decimalScale(cost) + decimalScale(quantity) + 8)),
  )
}

function signed(value: DecimalString): SignedDecimalString {
  return asSignedDecimalString(value)
}

function uniqueSorted(values: Iterable<string>): readonly string[] {
  return Object.freeze(Array.from(new Set(values)).sort())
}

export async function reconcileFillAccounting(
  input: FillAccountingReconciliationInput,
): Promise<FillAccountingReconciliationResult> {
  required(input.reconciliationId, 'reconciliationId')
  required(input.exchangeAccountId, 'exchangeAccountId')
  required(input.productId, 'productId')
  required(input.baseAsset, 'baseAsset')
  required(input.quoteAsset, 'quoteAsset')
  const observedAt = iso(input.observedAt, 'observedAt')

  const seenLots = new Set<string>()
  for (const lot of input.lots) {
    const lotId = required(lot.lotId, 'lotId')
    if (seenLots.has(lotId)) throw new TypeError(`duplicate lot ID: ${lotId}`)
    seenLots.add(lotId)
    asDecimalString(lot.remainingQuantity, `lot ${lotId} remainingQuantity`)
    asDecimalString(lot.remainingCostQuote, `lot ${lotId} remainingCostQuote`)
    if (
      (compareDecimal(lot.remainingQuantity, ZERO) === 0)
      !== (compareDecimal(lot.remainingCostQuote, ZERO) === 0)
    ) {
      throw new TypeError(`lot ${lotId} quantity and cost closure are inconsistent`)
    }
  }

  const reconstructedQuantity = sumDecimals(
    input.lots.map((lot) => lot.remainingQuantity),
  )
  const reconstructedCostBasisQuote = sumDecimals(
    input.lots.map((lot) => lot.remainingCostQuote),
  )
  const reconstructedAverageEntryPrice = averageEntryPrice(
    reconstructedCostBasisQuote,
    reconstructedQuantity,
  )
  const reconstructedRealizedPnlQuote = input.realizedPnlEvents.length === 0
    ? SIGNED_ZERO
    : sumSignedDecimals(input.realizedPnlEvents)

  const reasons = new Set<string>()
  if (compareDecimal(reconstructedQuantity, input.position.quantity) !== 0) {
    reasons.add('lot_quantity_mismatch')
  }
  if (compareDecimal(reconstructedCostBasisQuote, input.position.totalCostBasisQuote) !== 0) {
    reasons.add('lot_cost_basis_mismatch')
  }
  if (
    compareSignedDecimal(
      reconstructedRealizedPnlQuote,
      input.position.cumulativeRealizedPnlQuote,
    ) !== 0
  ) {
    reasons.add('realized_pnl_mismatch')
  }

  if (reconstructedAverageEntryPrice === null) {
    if (input.position.averageEntryPrice !== null) reasons.add('average_entry_price_mismatch')
  } else if (
    input.position.averageEntryPrice === null
    || compareDecimal(reconstructedAverageEntryPrice, input.position.averageEntryPrice) !== 0
  ) {
    reasons.add('average_entry_price_mismatch')
  }

  const expectedStatus = compareDecimal(input.position.quantity, ZERO) === 0 ? 'CLOSED' : 'OPEN'
  if (input.position.status !== expectedStatus) reasons.add('position_status_inconsistent')

  if (isNegativeSignedDecimal(input.ledgerBaseInventoryBalance)) {
    reasons.add('ledger_inventory_negative')
  } else if (
    compareSignedDecimal(
      input.ledgerBaseInventoryBalance,
      signed(input.position.quantity),
    ) !== 0
  ) {
    reasons.add('ledger_position_quantity_mismatch')
  }

  if (
    input.exchangeBaseBalance !== null
    && compareDecimal(input.exchangeBaseBalance, input.position.quantity) !== 0
  ) {
    reasons.add('exchange_position_quantity_mismatch')
  }

  let marketValueQuote: DecimalString | null = null
  let unrealizedPnlQuote: SignedDecimalString | null = null
  if (input.currentPrice !== null) {
    if (compareDecimal(input.currentPrice, ZERO) <= 0) {
      reasons.add('current_price_not_positive')
    } else {
      marketValueQuote = multiplyDecimal(input.position.quantity, input.currentPrice)
      unrealizedPnlQuote = subtractDecimal(
        marketValueQuote,
        input.position.totalCostBasisQuote,
      )
    }
  }

  const normalizedReasons = uniqueSorted(reasons)
  const status = normalizedReasons.length === 0 ? 'CLEAR' : 'HALT_FOR_REVIEW'
  const reconciliationHash = await canonicalHash({
    reconciliationId: input.reconciliationId,
    exchangeName: input.exchangeName,
    exchangeAccountId: input.exchangeAccountId,
    productId: input.productId,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
    position: input.position,
    reconstructedQuantity,
    reconstructedCostBasisQuote,
    reconstructedAverageEntryPrice,
    reconstructedRealizedPnlQuote,
    ledgerBaseInventoryBalance: input.ledgerBaseInventoryBalance,
    exchangeBaseBalance: input.exchangeBaseBalance,
    currentPrice: input.currentPrice,
    marketValueQuote,
    unrealizedPnlQuote,
    status,
    reasons: normalizedReasons,
    observedAt,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })

  return Object.freeze({
    reconciliationId: input.reconciliationId,
    status,
    reasons: normalizedReasons,
    reconstructedQuantity,
    reconstructedCostBasisQuote,
    reconstructedAverageEntryPrice,
    reconstructedRealizedPnlQuote,
    ledgerBaseInventoryBalance: input.ledgerBaseInventoryBalance,
    exchangeBaseBalance: input.exchangeBaseBalance,
    currentPrice: input.currentPrice,
    marketValueQuote,
    unrealizedPnlQuote,
    reconciliationHash,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export function calculateSignedLedgerBalance(
  entries: readonly {
    direction: 'DEBIT' | 'CREDIT'
    amount: DecimalString
  }[],
): SignedDecimalString {
  return entries.reduce<SignedDecimalString>((balance, entry) => {
    const amount = signed(entry.amount)
    return entry.direction === 'DEBIT'
      ? addSignedDecimal(balance, amount)
      : addSignedDecimal(balance, asSignedDecimalString(`-${entry.amount}`))
  }, SIGNED_ZERO)
}
