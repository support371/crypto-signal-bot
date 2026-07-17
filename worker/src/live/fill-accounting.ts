import { canonicalHash } from './canonical-json.ts'
import type { ExchangeFillSnapshot } from './exchange-contracts.ts'
import {
  buildSpotFillJournal,
  type LedgerJournalDraft,
} from './ledger.ts'
import {
  addDecimal,
  addSignedDecimal,
  asDecimalString,
  asSignedDecimalString,
  assertPositiveDecimal,
  compareDecimal,
  decimalScale,
  divideDecimalDown,
  multiplyDecimal,
  subtractDecimal,
  subtractNonNegativeDecimal,
  sumDecimals,
  type DecimalString,
  type SignedDecimalString,
} from './decimal.ts'

export type CostBasisMethod = 'FIFO'

export interface CostBasisLotState {
  lotId: string
  exchangeAccountId: string
  productId: string
  baseAsset: string
  quoteAsset: string
  acquiredFillId: string
  acquiredAt: string
  originalQuantity: DecimalString
  remainingQuantity: DecimalString
  originalCostQuote: DecimalString
  remainingCostQuote: DecimalString
  unitCostQuote: DecimalString
  method: CostBasisMethod
}

export interface LotConsumptionDraft {
  consumptionId: string
  lotId: string
  disposalFillId: string
  quantity: DecimalString
  costBasisQuote: DecimalString
  consumedAt: string
  method: CostBasisMethod
}

export interface RealizedPnlDraft {
  realizedPnlEventId: string
  exchangeAccountId: string
  internalOrderId: string
  fillId: string
  productId: string
  baseAsset: string
  quoteAsset: string
  disposedQuantity: DecimalString
  grossProceedsQuote: DecimalString
  feeQuoteValue: DecimalString
  netProceedsQuote: DecimalString
  costBasisQuote: DecimalString
  realizedPnlQuote: SignedDecimalString
  realizedAt: string
  method: CostBasisMethod
}

export interface PositionAccountingProjection {
  exchangeAccountId: string
  productId: string
  baseAsset: string
  quoteAsset: string
  quantity: DecimalString
  totalCostBasisQuote: DecimalString
  averageEntryPrice: DecimalString | null
  cumulativeRealizedPnlQuote: SignedDecimalString
  currentPrice: DecimalString | null
  marketValueQuote: DecimalString | null
  unrealizedPnlQuote: SignedDecimalString | null
  status: 'OPEN' | 'CLOSED'
  observedAt: string
}

export interface FillAccountingAccounts {
  baseInventoryAccountId: string
  baseReservedAccountId: string
  baseClearingAccountId: string
  quoteAvailableAccountId: string
  quoteReservedAccountId: string
  quoteClearingAccountId: string
  feeExpenseAccountId: string | null
  feeSourceAccountId: string | null
}

export interface FillAccountingInput {
  journalId: string
  exchangeAccountId: string
  internalOrderId: string
  correlationId: string
  idempotencyKey: string
  baseAsset: string
  quoteAsset: string
  fill: ExchangeFillSnapshot
  existingLots: readonly CostBasisLotState[]
  cumulativeRealizedPnlQuote: SignedDecimalString
  feeQuoteValue: DecimalString | null
  acquisitionLotId: string
  accounts: FillAccountingAccounts
}

export interface FillAccountingResult {
  method: CostBasisMethod
  journal: LedgerJournalDraft
  acquiredLot: CostBasisLotState | null
  lotConsumptions: readonly LotConsumptionDraft[]
  updatedLots: readonly CostBasisLotState[]
  realizedPnlEvent: RealizedPnlDraft | null
  position: PositionAccountingProjection
  accountingHash: string
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export class InsufficientCostBasisError extends Error {
  readonly requiredQuantity: DecimalString
  readonly availableQuantity: DecimalString

  constructor(requiredQuantity: DecimalString, availableQuantity: DecimalString) {
    super(`Insufficient FIFO cost basis: required ${requiredQuantity}, available ${availableQuantity}`)
    this.name = 'InsufficientCostBasisError'
    this.requiredQuantity = requiredQuantity
    this.availableQuantity = availableQuantity
  }
}

const ZERO = asDecimalString('0')
const COST_SCALE = 36

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function asset(value: string, field: string): string {
  const normalized = required(value, field).toUpperCase()
  if (!/^[A-Z0-9]{2,20}$/.test(normalized)) {
    throw new TypeError(`${field} must be an uppercase asset code`)
  }
  return normalized
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function positiveOrZero(value: DecimalString, field: string): DecimalString {
  return asDecimalString(value, field)
}

function isZero(value: DecimalString): boolean {
  return compareDecimal(value, ZERO) === 0
}

function feeContext(input: FillAccountingInput): {
  commission: DecimalString
  commissionAsset: string | null
  feeQuoteValue: DecimalString
} {
  const commission = positiveOrZero(input.fill.commission, 'commission')
  const commissionAsset = input.fill.commissionAsset?.trim().toUpperCase() || null
  const baseAsset = asset(input.baseAsset, 'baseAsset')
  const quoteAsset = asset(input.quoteAsset, 'quoteAsset')

  if (isZero(commission)) {
    if (input.feeQuoteValue !== null && !isZero(input.feeQuoteValue)) {
      throw new TypeError('feeQuoteValue must be zero or null when commission is zero')
    }
    return { commission, commissionAsset: null, feeQuoteValue: ZERO }
  }

  if (!commissionAsset) throw new TypeError('commissionAsset is required when commission is positive')
  if (!input.accounts.feeExpenseAccountId || !input.accounts.feeSourceAccountId) {
    throw new TypeError('fee ledger accounts are required when commission is positive')
  }

  if (commissionAsset === quoteAsset) {
    if (input.feeQuoteValue !== null && compareDecimal(input.feeQuoteValue, commission) !== 0) {
      throw new TypeError('quote-asset feeQuoteValue must equal commission')
    }
    return { commission, commissionAsset, feeQuoteValue: commission }
  }

  if (commissionAsset === baseAsset) {
    if (input.feeQuoteValue !== null && !isZero(input.feeQuoteValue)) {
      throw new TypeError('base-asset commission is accounted through quantity, not feeQuoteValue')
    }
    return { commission, commissionAsset, feeQuoteValue: ZERO }
  }

  if (input.feeQuoteValue === null || compareDecimal(input.feeQuoteValue, ZERO) <= 0) {
    throw new TypeError('positive feeQuoteValue is required for third-asset commission')
  }
  return {
    commission,
    commissionAsset,
    feeQuoteValue: input.feeQuoteValue,
  }
}

function validateLot(lot: CostBasisLotState, input: FillAccountingInput): CostBasisLotState {
  if (lot.exchangeAccountId !== input.exchangeAccountId) {
    throw new TypeError(`lot ${lot.lotId} belongs to a different exchange account`)
  }
  if (lot.productId !== input.fill.productId) {
    throw new TypeError(`lot ${lot.lotId} belongs to a different product`)
  }
  if (lot.baseAsset !== input.baseAsset || lot.quoteAsset !== input.quoteAsset) {
    throw new TypeError(`lot ${lot.lotId} asset pair does not match fill`)
  }
  if (lot.method !== 'FIFO') throw new TypeError(`lot ${lot.lotId} must use FIFO`)
  iso(lot.acquiredAt, `lot ${lot.lotId} acquiredAt`)
  assertPositiveDecimal(lot.originalQuantity, `lot ${lot.lotId} originalQuantity`)
  assertPositiveDecimal(lot.originalCostQuote, `lot ${lot.lotId} originalCostQuote`)
  positiveOrZero(lot.remainingQuantity, `lot ${lot.lotId} remainingQuantity`)
  positiveOrZero(lot.remainingCostQuote, `lot ${lot.lotId} remainingCostQuote`)
  if (compareDecimal(lot.remainingQuantity, lot.originalQuantity) > 0) {
    throw new TypeError(`lot ${lot.lotId} remaining quantity exceeds original quantity`)
  }
  if (compareDecimal(lot.remainingCostQuote, lot.originalCostQuote) > 0) {
    throw new TypeError(`lot ${lot.lotId} remaining cost exceeds original cost`)
  }
  if (isZero(lot.remainingQuantity) !== isZero(lot.remainingCostQuote)) {
    throw new TypeError(`lot ${lot.lotId} quantity and cost closure are inconsistent`)
  }
  return lot
}

function sortedLots(input: FillAccountingInput): CostBasisLotState[] {
  const seen = new Set<string>()
  return input.existingLots
    .map((lot) => {
      if (seen.has(lot.lotId)) throw new TypeError(`duplicate lot ID: ${lot.lotId}`)
      seen.add(lot.lotId)
      return validateLot(lot, input)
    })
    .filter((lot) => !isZero(lot.remainingQuantity))
    .sort((left, right) => {
      const time = Date.parse(left.acquiredAt) - Date.parse(right.acquiredAt)
      return time !== 0 ? time : left.lotId.localeCompare(right.lotId)
    })
}

function quoteValue(fill: ExchangeFillSnapshot): DecimalString {
  return multiplyDecimal(
    assertPositiveDecimal(fill.price, 'fill.price'),
    assertPositiveDecimal(fill.baseSize, 'fill.baseSize'),
  )
}

function unitCost(cost: DecimalString, quantity: DecimalString): DecimalString {
  return divideDecimalDown(
    cost,
    assertPositiveDecimal(quantity, 'quantity'),
    Math.min(COST_SCALE, Math.max(18, decimalScale(cost) + decimalScale(quantity) + 8)),
  )
}

function buildJournal(
  input: FillAccountingInput,
  commissionAsset: string | null,
  commission: DecimalString,
  grossQuoteValue: DecimalString,
): LedgerJournalDraft {
  return buildSpotFillJournal({
    journalId: required(input.journalId, 'journalId'),
    exchangeAccountId: required(input.exchangeAccountId, 'exchangeAccountId'),
    orderId: required(input.internalOrderId, 'internalOrderId'),
    fillId: required(input.fill.fillId, 'fill.fillId'),
    correlationId: required(input.correlationId, 'correlationId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    side: input.fill.side,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
    baseAmount: input.fill.baseSize,
    quoteAmount: grossQuoteValue,
    baseInventoryAccountId: required(input.accounts.baseInventoryAccountId, 'baseInventoryAccountId'),
    baseReservedAccountId: required(input.accounts.baseReservedAccountId, 'baseReservedAccountId'),
    baseClearingAccountId: required(input.accounts.baseClearingAccountId, 'baseClearingAccountId'),
    quoteAvailableAccountId: required(input.accounts.quoteAvailableAccountId, 'quoteAvailableAccountId'),
    quoteReservedAccountId: required(input.accounts.quoteReservedAccountId, 'quoteReservedAccountId'),
    quoteClearingAccountId: required(input.accounts.quoteClearingAccountId, 'quoteClearingAccountId'),
    feeAsset: commissionAsset,
    feeAmount: isZero(commission) ? null : commission,
    feeExpenseAccountId: input.accounts.feeExpenseAccountId,
    feeSourceAccountId: input.accounts.feeSourceAccountId,
  })
}

function buyAccounting(
  input: FillAccountingInput,
  lots: readonly CostBasisLotState[],
  grossQuoteValue: DecimalString,
  commissionAsset: string | null,
  commission: DecimalString,
  feeQuoteValue: DecimalString,
): Omit<FillAccountingResult, 'journal' | 'accountingHash'> {
  const netBaseQuantity = commissionAsset === input.baseAsset
    ? subtractNonNegativeDecimal(input.fill.baseSize, commission, 'netBaseQuantity')
    : input.fill.baseSize
  assertPositiveDecimal(netBaseQuantity, 'netBaseQuantity')

  const totalCostQuote = addDecimal(grossQuoteValue, feeQuoteValue)
  const acquiredLot: CostBasisLotState = Object.freeze({
    lotId: required(input.acquisitionLotId, 'acquisitionLotId'),
    exchangeAccountId: input.exchangeAccountId,
    productId: input.fill.productId,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
    acquiredFillId: input.fill.fillId,
    acquiredAt: iso(input.fill.tradeTime, 'fill.tradeTime'),
    originalQuantity: netBaseQuantity,
    remainingQuantity: netBaseQuantity,
    originalCostQuote: totalCostQuote,
    remainingCostQuote: totalCostQuote,
    unitCostQuote: unitCost(totalCostQuote, netBaseQuantity),
    method: 'FIFO',
  })
  const updatedLots = Object.freeze([...lots, acquiredLot])
  const quantity = sumDecimals(updatedLots.map((lot) => lot.remainingQuantity))
  const totalCostBasisQuote = sumDecimals(updatedLots.map((lot) => lot.remainingCostQuote))

  return {
    method: 'FIFO',
    acquiredLot,
    lotConsumptions: Object.freeze([]),
    updatedLots,
    realizedPnlEvent: null,
    position: Object.freeze({
      exchangeAccountId: input.exchangeAccountId,
      productId: input.fill.productId,
      baseAsset: input.baseAsset,
      quoteAsset: input.quoteAsset,
      quantity,
      totalCostBasisQuote,
      averageEntryPrice: unitCost(totalCostBasisQuote, quantity),
      cumulativeRealizedPnlQuote: input.cumulativeRealizedPnlQuote,
      currentPrice: null,
      marketValueQuote: null,
      unrealizedPnlQuote: null,
      status: 'OPEN',
      observedAt: iso(input.fill.sequenceTimestamp, 'fill.sequenceTimestamp'),
    }),
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  }
}

function sellAccounting(
  input: FillAccountingInput,
  lots: readonly CostBasisLotState[],
  grossQuoteValue: DecimalString,
  commissionAsset: string | null,
  commission: DecimalString,
  feeQuoteValue: DecimalString,
): Omit<FillAccountingResult, 'journal' | 'accountingHash'> {
  const disposedQuantity = commissionAsset === input.baseAsset
    ? addDecimal(input.fill.baseSize, commission)
    : input.fill.baseSize
  const availableQuantity = sumDecimals(lots.map((lot) => lot.remainingQuantity))
  if (compareDecimal(availableQuantity, disposedQuantity) < 0) {
    throw new InsufficientCostBasisError(disposedQuantity, availableQuantity)
  }

  let remainingDisposal = disposedQuantity
  const updatedLots: CostBasisLotState[] = []
  const consumptions: LotConsumptionDraft[] = []

  for (const lot of lots) {
    if (isZero(remainingDisposal)) {
      updatedLots.push(lot)
      continue
    }

    const consumeQuantity = compareDecimal(lot.remainingQuantity, remainingDisposal) <= 0
      ? lot.remainingQuantity
      : remainingDisposal
    const consumeAll = compareDecimal(consumeQuantity, lot.remainingQuantity) === 0
    const consumedCost = consumeAll
      ? lot.remainingCostQuote
      : divideDecimalDown(
        multiplyDecimal(lot.remainingCostQuote, consumeQuantity),
        lot.remainingQuantity,
        COST_SCALE,
      )
    const remainingQuantity = subtractNonNegativeDecimal(
      lot.remainingQuantity,
      consumeQuantity,
      'remainingLotQuantity',
    )
    const remainingCostQuote = subtractNonNegativeDecimal(
      lot.remainingCostQuote,
      consumedCost,
      'remainingLotCostQuote',
    )

    consumptions.push(Object.freeze({
      consumptionId: `lot-consumption:${input.fill.fillId}:${lot.lotId}`,
      lotId: lot.lotId,
      disposalFillId: input.fill.fillId,
      quantity: consumeQuantity,
      costBasisQuote: consumedCost,
      consumedAt: iso(input.fill.tradeTime, 'fill.tradeTime'),
      method: 'FIFO',
    }))
    updatedLots.push(Object.freeze({
      ...lot,
      remainingQuantity,
      remainingCostQuote,
    }))
    remainingDisposal = subtractNonNegativeDecimal(
      remainingDisposal,
      consumeQuantity,
      'remainingDisposal',
    )
  }

  if (!isZero(remainingDisposal)) {
    throw new InsufficientCostBasisError(disposedQuantity, availableQuantity)
  }

  const costBasisQuote = sumDecimals(consumptions.map((item) => item.costBasisQuote))
  const quoteFee = commissionAsset === input.quoteAsset ? commission : feeQuoteValue
  const netProceedsQuote = subtractNonNegativeDecimal(
    grossQuoteValue,
    quoteFee,
    'netProceedsQuote',
  )
  const realizedPnlQuote = subtractDecimal(netProceedsQuote, costBasisQuote)
  const cumulativeRealizedPnlQuote = addSignedDecimal(
    input.cumulativeRealizedPnlQuote,
    realizedPnlQuote,
  )
  const openLots = updatedLots.filter((lot) => !isZero(lot.remainingQuantity))
  const quantity = sumDecimals(openLots.map((lot) => lot.remainingQuantity))
  const totalCostBasisQuote = sumDecimals(openLots.map((lot) => lot.remainingCostQuote))

  const realizedPnlEvent: RealizedPnlDraft = Object.freeze({
    realizedPnlEventId: `realized-pnl:${input.fill.fillId}`,
    exchangeAccountId: input.exchangeAccountId,
    internalOrderId: input.internalOrderId,
    fillId: input.fill.fillId,
    productId: input.fill.productId,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
    disposedQuantity,
    grossProceedsQuote: grossQuoteValue,
    feeQuoteValue: quoteFee,
    netProceedsQuote,
    costBasisQuote,
    realizedPnlQuote,
    realizedAt: iso(input.fill.tradeTime, 'fill.tradeTime'),
    method: 'FIFO',
  })

  return {
    method: 'FIFO',
    acquiredLot: null,
    lotConsumptions: Object.freeze(consumptions),
    updatedLots: Object.freeze(updatedLots),
    realizedPnlEvent,
    position: Object.freeze({
      exchangeAccountId: input.exchangeAccountId,
      productId: input.fill.productId,
      baseAsset: input.baseAsset,
      quoteAsset: input.quoteAsset,
      quantity,
      totalCostBasisQuote,
      averageEntryPrice: isZero(quantity) ? null : unitCost(totalCostBasisQuote, quantity),
      cumulativeRealizedPnlQuote,
      currentPrice: null,
      marketValueQuote: null,
      unrealizedPnlQuote: null,
      status: isZero(quantity) ? 'CLOSED' : 'OPEN',
      observedAt: iso(input.fill.sequenceTimestamp, 'fill.sequenceTimestamp'),
    }),
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  }
}

export async function accountSpotFillFifo(
  input: FillAccountingInput,
): Promise<FillAccountingResult> {
  required(input.exchangeAccountId, 'exchangeAccountId')
  required(input.internalOrderId, 'internalOrderId')
  required(input.fill.fillId, 'fill.fillId')
  required(input.fill.tradeId, 'fill.tradeId')
  required(input.fill.exchangeOrderId, 'fill.exchangeOrderId')
  required(input.fill.productId, 'fill.productId')
  asset(input.baseAsset, 'baseAsset')
  asset(input.quoteAsset, 'quoteAsset')
  iso(input.fill.tradeTime, 'fill.tradeTime')
  iso(input.fill.sequenceTimestamp, 'fill.sequenceTimestamp')
  asSignedDecimalString(input.cumulativeRealizedPnlQuote, 'cumulativeRealizedPnlQuote')

  const lots = sortedLots(input)
  const grossQuoteValue = quoteValue(input.fill)
  const fee = feeContext(input)
  const journal = buildJournal(
    input,
    fee.commissionAsset,
    fee.commission,
    grossQuoteValue,
  )
  const accounting = input.fill.side === 'BUY'
    ? buyAccounting(
      input,
      lots,
      grossQuoteValue,
      fee.commissionAsset,
      fee.commission,
      fee.feeQuoteValue,
    )
    : sellAccounting(
      input,
      lots,
      grossQuoteValue,
      fee.commissionAsset,
      fee.commission,
      fee.feeQuoteValue,
    )
  const accountingHash = await canonicalHash({
    method: accounting.method,
    fill: input.fill,
    journal,
    acquiredLot: accounting.acquiredLot,
    lotConsumptions: accounting.lotConsumptions,
    position: accounting.position,
    realizedPnlEvent: accounting.realizedPnlEvent,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })

  return Object.freeze({
    ...accounting,
    journal,
    accountingHash,
  })
}

export function markPositionToMarket(
  position: PositionAccountingProjection,
  currentPrice: DecimalString,
  observedAt: string,
): PositionAccountingProjection {
  const price = assertPositiveDecimal(currentPrice, 'currentPrice')
  const marketValueQuote = multiplyDecimal(position.quantity, price)
  const unrealizedPnlQuote = subtractDecimal(marketValueQuote, position.totalCostBasisQuote)
  return Object.freeze({
    ...position,
    currentPrice: price,
    marketValueQuote,
    unrealizedPnlQuote,
    observedAt: iso(observedAt, 'observedAt'),
  })
}
