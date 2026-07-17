import {
  addDecimal,
  asDecimalString,
  assertPositiveDecimal,
  compareDecimal,
  type DecimalString,
} from './decimal.ts'

export type LedgerDirection = 'DEBIT' | 'CREDIT'

export interface LedgerEntryDraft {
  entryId: string
  ledgerAccountId: string
  asset: string
  direction: LedgerDirection
  amount: DecimalString
}

export interface LedgerJournalDraft {
  journalId: string
  exchangeAccountId: string
  eventType: string
  referenceType: string
  referenceId: string
  correlationId: string
  idempotencyKey: string
  entries: readonly LedgerEntryDraft[]
}

export interface ReservationJournalInput {
  journalId: string
  exchangeAccountId: string
  orderId: string
  correlationId: string
  idempotencyKey: string
  asset: string
  amount: DecimalString
  availableAccountId: string
  reservedAccountId: string
}

export interface SpotFillJournalInput {
  journalId: string
  exchangeAccountId: string
  orderId: string
  fillId: string
  correlationId: string
  idempotencyKey: string
  side: 'BUY' | 'SELL'
  baseAsset: string
  quoteAsset: string
  baseAmount: DecimalString
  quoteAmount: DecimalString
  baseInventoryAccountId: string
  baseReservedAccountId: string
  baseClearingAccountId: string
  quoteAvailableAccountId: string
  quoteReservedAccountId: string
  quoteClearingAccountId: string
  feeAsset?: string | null
  feeAmount?: DecimalString | null
  feeExpenseAccountId?: string | null
  feeSourceAccountId?: string | null
}

export class UnbalancedJournalError extends Error {
  readonly differences: Readonly<Record<string, { debits: string; credits: string }>>

  constructor(differences: Readonly<Record<string, { debits: string; credits: string }>>) {
    super(`Ledger journal is not balanced for asset(s): ${Object.keys(differences).join(', ')}`)
    this.name = 'UnbalancedJournalError'
    this.differences = differences
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function assetCode(value: string): string {
  return required(value, 'asset').toUpperCase()
}

function entry(
  entryId: string,
  ledgerAccountId: string,
  asset: string,
  direction: LedgerDirection,
  amount: DecimalString,
): LedgerEntryDraft {
  return {
    entryId: required(entryId, 'entryId'),
    ledgerAccountId: required(ledgerAccountId, 'ledgerAccountId'),
    asset: assetCode(asset),
    direction,
    amount: assertPositiveDecimal(asDecimalString(amount, 'amount'), 'amount'),
  }
}

export function validateBalancedJournal(journal: LedgerJournalDraft): LedgerJournalDraft {
  required(journal.journalId, 'journalId')
  required(journal.exchangeAccountId, 'exchangeAccountId')
  required(journal.eventType, 'eventType')
  required(journal.referenceType, 'referenceType')
  required(journal.referenceId, 'referenceId')
  required(journal.correlationId, 'correlationId')
  required(journal.idempotencyKey, 'idempotencyKey')

  if (journal.entries.length < 2) {
    throw new UnbalancedJournalError({ journal: { debits: '0', credits: '0' } })
  }

  const seenEntryIds = new Set<string>()
  const totals = new Map<string, { debit: DecimalString; credit: DecimalString }>()
  const normalizedEntries = journal.entries.map((draft) => {
    const normalized = entry(
      draft.entryId,
      draft.ledgerAccountId,
      draft.asset,
      draft.direction,
      draft.amount,
    )
    if (seenEntryIds.has(normalized.entryId)) {
      throw new TypeError(`Duplicate ledger entry ID: ${normalized.entryId}`)
    }
    seenEntryIds.add(normalized.entryId)

    const current = totals.get(normalized.asset) ?? {
      debit: asDecimalString('0'),
      credit: asDecimalString('0'),
    }
    if (normalized.direction === 'DEBIT') {
      current.debit = addDecimal(current.debit, normalized.amount)
    } else {
      current.credit = addDecimal(current.credit, normalized.amount)
    }
    totals.set(normalized.asset, current)
    return normalized
  })

  const differences: Record<string, { debits: string; credits: string }> = {}
  for (const [asset, total] of totals.entries()) {
    if (compareDecimal(total.debit, total.credit) !== 0) {
      differences[asset] = { debits: total.debit, credits: total.credit }
    }
  }
  if (Object.keys(differences).length > 0) {
    throw new UnbalancedJournalError(differences)
  }

  return { ...journal, entries: normalizedEntries }
}

export function buildReservationJournal(input: ReservationJournalInput): LedgerJournalDraft {
  const amount = assertPositiveDecimal(input.amount, 'amount')
  return validateBalancedJournal({
    journalId: input.journalId,
    exchangeAccountId: input.exchangeAccountId,
    eventType: 'FUNDS_RESERVED',
    referenceType: 'ORDER',
    referenceId: input.orderId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    entries: [
      entry(
        `${input.journalId}:reserved:debit`,
        input.reservedAccountId,
        input.asset,
        'DEBIT',
        amount,
      ),
      entry(
        `${input.journalId}:available:credit`,
        input.availableAccountId,
        input.asset,
        'CREDIT',
        amount,
      ),
    ],
  })
}

export function buildReservationReleaseJournal(
  input: ReservationJournalInput,
): LedgerJournalDraft {
  const amount = assertPositiveDecimal(input.amount, 'amount')
  return validateBalancedJournal({
    journalId: input.journalId,
    exchangeAccountId: input.exchangeAccountId,
    eventType: 'FUNDS_RESERVATION_RELEASED',
    referenceType: 'ORDER',
    referenceId: input.orderId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    entries: [
      entry(
        `${input.journalId}:available:debit`,
        input.availableAccountId,
        input.asset,
        'DEBIT',
        amount,
      ),
      entry(
        `${input.journalId}:reserved:credit`,
        input.reservedAccountId,
        input.asset,
        'CREDIT',
        amount,
      ),
    ],
  })
}

export function buildSpotFillJournal(input: SpotFillJournalInput): LedgerJournalDraft {
  const baseAmount = assertPositiveDecimal(input.baseAmount, 'baseAmount')
  const quoteAmount = assertPositiveDecimal(input.quoteAmount, 'quoteAmount')
  const entries: LedgerEntryDraft[] = []

  if (input.side === 'BUY') {
    entries.push(
      entry(
        `${input.journalId}:quote-clearing:debit`,
        input.quoteClearingAccountId,
        input.quoteAsset,
        'DEBIT',
        quoteAmount,
      ),
      entry(
        `${input.journalId}:quote-reserved:credit`,
        input.quoteReservedAccountId,
        input.quoteAsset,
        'CREDIT',
        quoteAmount,
      ),
      entry(
        `${input.journalId}:base-inventory:debit`,
        input.baseInventoryAccountId,
        input.baseAsset,
        'DEBIT',
        baseAmount,
      ),
      entry(
        `${input.journalId}:base-clearing:credit`,
        input.baseClearingAccountId,
        input.baseAsset,
        'CREDIT',
        baseAmount,
      ),
    )
  } else {
    entries.push(
      entry(
        `${input.journalId}:base-clearing:debit`,
        input.baseClearingAccountId,
        input.baseAsset,
        'DEBIT',
        baseAmount,
      ),
      entry(
        `${input.journalId}:base-reserved:credit`,
        input.baseReservedAccountId,
        input.baseAsset,
        'CREDIT',
        baseAmount,
      ),
      entry(
        `${input.journalId}:quote-available:debit`,
        input.quoteAvailableAccountId,
        input.quoteAsset,
        'DEBIT',
        quoteAmount,
      ),
      entry(
        `${input.journalId}:quote-clearing:credit`,
        input.quoteClearingAccountId,
        input.quoteAsset,
        'CREDIT',
        quoteAmount,
      ),
    )
  }

  if (input.feeAmount !== null && input.feeAmount !== undefined) {
    if (!input.feeAsset || !input.feeExpenseAccountId || !input.feeSourceAccountId) {
      throw new TypeError(
        'feeAsset, feeExpenseAccountId, and feeSourceAccountId are required when feeAmount is present',
      )
    }
    const feeAmount = assertPositiveDecimal(input.feeAmount, 'feeAmount')
    entries.push(
      entry(
        `${input.journalId}:fee-expense:debit`,
        input.feeExpenseAccountId,
        input.feeAsset,
        'DEBIT',
        feeAmount,
      ),
      entry(
        `${input.journalId}:fee-source:credit`,
        input.feeSourceAccountId,
        input.feeAsset,
        'CREDIT',
        feeAmount,
      ),
    )
  }

  return validateBalancedJournal({
    journalId: input.journalId,
    exchangeAccountId: input.exchangeAccountId,
    eventType: 'SPOT_FILL_POSTED',
    referenceType: 'FILL',
    referenceId: input.fillId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    entries,
  })
}
