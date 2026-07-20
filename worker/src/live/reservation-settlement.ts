import { canonicalHash } from './canonical-json.ts'
import {
  addDecimal,
  asDecimalString,
  assertPositiveDecimal,
  compareDecimal,
  subtractNonNegativeDecimal,
  sumDecimals,
  type DecimalString,
} from './decimal.ts'
import {
  buildReservationReleaseJournal,
  validateBalancedJournal,
  type LedgerJournalDraft,
} from './ledger.ts'

export type SettleableReservationStatus = 'ACTIVE' | 'PARTIALLY_CONSUMED'
export type SettledReservationStatus = 'PARTIALLY_CONSUMED' | 'CONSUMED' | 'RELEASED'

export interface ReservationSettlementState {
  reservationId: string
  exchangeAccountId: string
  orderId: string
  asset: string
  amount: DecimalString
  consumedAmount: DecimalString
  status: SettleableReservationStatus
  version: number
}

export interface ReservationSettlementInput {
  settlementReceiptId: string
  fillId: string
  accountingHash: string
  internalOrderId: string
  correlationId: string
  idempotencyKey: string
  settledAt: string
  terminalFill: boolean
  reservation: ReservationSettlementState
  fillJournal: LedgerJournalDraft
  availableAccountId: string
  reservedAccountId: string
  releaseJournalId: string
}

export interface ReservationSettlementPlan {
  settlementReceiptId: string
  fillId: string
  accountingHash: string
  reservationId: string
  asset: string
  previousVersion: number
  nextVersion: number
  consumedDelta: DecimalString
  previousConsumedAmount: DecimalString
  nextConsumedAmount: DecimalString
  releasedAmount: DecimalString
  previousStatus: SettleableReservationStatus
  nextStatus: SettledReservationStatus
  releaseJournalDraft: LedgerJournalDraft | null
  settlementHash: string
  reservationStateUpdated: false
  releaseJournalPosted: false
  providerMutationAllowed: false
  executionAllowed: false
}

const ZERO = asDecimalString('0')

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

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function isZero(value: DecimalString): boolean {
  return compareDecimal(value, ZERO) === 0
}

function validateReservation(state: ReservationSettlementState): ReservationSettlementState {
  required(state.reservationId, 'reservationId')
  required(state.exchangeAccountId, 'exchangeAccountId')
  required(state.orderId, 'orderId')
  const normalizedAsset = asset(state.asset, 'reservation.asset')
  const amount = assertPositiveDecimal(asDecimalString(state.amount, 'reservation.amount'), 'reservation.amount')
  const consumedAmount = asDecimalString(state.consumedAmount, 'reservation.consumedAmount')
  if (compareDecimal(consumedAmount, amount) > 0) {
    throw new RangeError('reservation consumed amount exceeds reserved amount')
  }
  if (!Number.isSafeInteger(state.version) || state.version < 0) {
    throw new RangeError('reservation version must be a non-negative safe integer')
  }
  if (state.status === 'ACTIVE' && !isZero(consumedAmount)) {
    throw new TypeError('ACTIVE reservation cannot have consumed amount')
  }
  if (state.status === 'PARTIALLY_CONSUMED' && isZero(consumedAmount)) {
    throw new TypeError('PARTIALLY_CONSUMED reservation requires consumed amount')
  }
  if (compareDecimal(consumedAmount, amount) === 0) {
    throw new TypeError('settleable reservation cannot already be fully consumed')
  }
  return Object.freeze({
    ...state,
    asset: normalizedAsset,
    amount,
    consumedAmount,
  })
}

function consumedFromFillJournal(
  journal: LedgerJournalDraft,
  reservationAsset: string,
  reservedAccountId: string,
  fillId: string,
  exchangeAccountId: string,
): DecimalString {
  const balanced = validateBalancedJournal(journal)
  if (balanced.exchangeAccountId !== exchangeAccountId) {
    throw new TypeError('fill journal exchange account does not match reservation')
  }
  if (balanced.eventType !== 'SPOT_FILL_POSTED') {
    throw new TypeError('reservation settlement requires a SPOT_FILL_POSTED journal')
  }
  if (balanced.referenceType !== 'FILL' || balanced.referenceId !== fillId) {
    throw new TypeError('fill journal reference does not match settlement fill')
  }

  const relevant = balanced.entries.filter(
    (entry) => entry.ledgerAccountId === reservedAccountId && entry.asset === reservationAsset,
  )
  if (relevant.some((entry) => entry.direction !== 'CREDIT')) {
    throw new TypeError('fill journal cannot debit the reservation account during settlement')
  }
  const consumed = sumDecimals(relevant.map((entry) => entry.amount))
  return assertPositiveDecimal(consumed, 'reservation consumed delta')
}

export async function buildReservationSettlementPlan(
  input: ReservationSettlementInput,
): Promise<ReservationSettlementPlan> {
  const settlementReceiptId = required(input.settlementReceiptId, 'settlementReceiptId')
  const fillId = required(input.fillId, 'fillId')
  const accountingHash = required(input.accountingHash, 'accountingHash').toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(accountingHash)) {
    throw new TypeError('accountingHash must be a lowercase SHA-256 hash')
  }
  const internalOrderId = required(input.internalOrderId, 'internalOrderId')
  const settledAt = timestamp(input.settledAt, 'settledAt')
  const reservation = validateReservation(input.reservation)
  if (reservation.orderId !== internalOrderId) {
    throw new TypeError('reservation order does not match accounting order')
  }

  const availableAccountId = required(input.availableAccountId, 'availableAccountId')
  const reservedAccountId = required(input.reservedAccountId, 'reservedAccountId')
  const consumedDelta = consumedFromFillJournal(
    input.fillJournal,
    reservation.asset,
    reservedAccountId,
    fillId,
    reservation.exchangeAccountId,
  )
  const nextConsumedAmount = addDecimal(reservation.consumedAmount, consumedDelta)
  if (compareDecimal(nextConsumedAmount, reservation.amount) > 0) {
    throw new RangeError('fill settlement exceeds reserved amount')
  }

  const remainingAmount = subtractNonNegativeDecimal(
    reservation.amount,
    nextConsumedAmount,
    'reservation remaining amount',
  )
  let nextStatus: SettledReservationStatus
  let releasedAmount = ZERO
  let releaseJournalDraft: LedgerJournalDraft | null = null

  if (isZero(remainingAmount)) {
    nextStatus = 'CONSUMED'
  } else if (input.terminalFill) {
    nextStatus = 'RELEASED'
    releasedAmount = remainingAmount
    releaseJournalDraft = buildReservationReleaseJournal({
      journalId: required(input.releaseJournalId, 'releaseJournalId'),
      exchangeAccountId: reservation.exchangeAccountId,
      orderId: reservation.orderId,
      correlationId: required(input.correlationId, 'correlationId'),
      idempotencyKey: `${required(input.idempotencyKey, 'idempotencyKey')}:release`,
      asset: reservation.asset,
      amount: releasedAmount,
      availableAccountId,
      reservedAccountId,
    })
  } else {
    nextStatus = 'PARTIALLY_CONSUMED'
  }

  const evidence = {
    settlementReceiptId,
    fillId,
    accountingHash,
    reservationId: reservation.reservationId,
    asset: reservation.asset,
    previousVersion: reservation.version,
    nextVersion: reservation.version + 1,
    consumedDelta,
    previousConsumedAmount: reservation.consumedAmount,
    nextConsumedAmount,
    releasedAmount,
    previousStatus: reservation.status,
    nextStatus,
    releaseJournalDraft,
    settledAt,
    reservationStateUpdated: false,
    releaseJournalPosted: false,
    providerMutationAllowed: false,
    executionAllowed: false,
  }
  const settlementHash = await canonicalHash(evidence)

  return Object.freeze({
    settlementReceiptId,
    fillId,
    accountingHash,
    reservationId: reservation.reservationId,
    asset: reservation.asset,
    previousVersion: reservation.version,
    nextVersion: reservation.version + 1,
    consumedDelta,
    previousConsumedAmount: reservation.consumedAmount,
    nextConsumedAmount,
    releasedAmount,
    previousStatus: reservation.status,
    nextStatus,
    releaseJournalDraft,
    settlementHash,
    reservationStateUpdated: false,
    releaseJournalPosted: false,
    providerMutationAllowed: false,
    executionAllowed: false,
  })
}
