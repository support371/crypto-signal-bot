import { canonicalHash } from './canonical-json.ts'
import {
  asDecimalString,
  type DecimalString,
} from './decimal.ts'
import type {
  LedgerDirection,
  LedgerJournalDraft,
} from './ledger.ts'
import {
  buildReservationSettlementPlan,
  type SettledReservationStatus,
  type SettleableReservationStatus,
} from './reservation-settlement.ts'

export interface ReservationSettlementStoreEnv {
  DB: D1Database
}

export interface PersistReservationSettlementInput {
  reservationId: string
  fillId: string
  accountingHash: string
  terminalFill: boolean
  availableAccountId: string
  reservedAccountId: string
  releaseJournalId: string
  correlationId: string
  idempotencyKey: string
  settledAt: string
}

export interface PersistReservationSettlementResult {
  status: 'SETTLED' | 'REPLAYED'
  settlementReceiptId: string
  reservationId: string
  fillId: string
  consumedDelta: DecimalString
  nextConsumedAmount: DecimalString
  releasedAmount: DecimalString
  nextStatus: SettledReservationStatus
  nextVersion: number
  settlementHash: string
  reservationStateUpdated: true
  releaseJournalPosted: boolean
  providerMutationAllowed: false
  executionAllowed: false
}

export class ReservationSettlementConflictError extends Error {
  readonly code = 'RESERVATION_SETTLEMENT_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'ReservationSettlementConflictError'
  }
}

type AccountingReceiptRow = {
  internal_order_id: string
  accounting_hash: string
  journal_id: string
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

type ReservationRow = {
  reservation_id: string
  exchange_account_id: string
  order_id: string
  asset: string
  amount: string
  consumed_amount: string
  status: string
  version: number
}

type JournalRow = {
  journal_id: string
  exchange_account_id: string
  event_type: string
  reference_type: string
  reference_id: string
  correlation_id: string
  idempotency_key: string
  status: string
}

type JournalEntryRow = {
  entry_id: string
  ledger_account_id: string
  asset: string
  direction: string
  amount: string
}

type SettlementReceiptRow = {
  settlement_receipt_id: string
  request_hash: string
  accounting_hash: string
  reservation_id: string
  fill_id: string
  consumed_delta: string
  next_consumed_amount: string
  released_amount: string
  next_status: SettledReservationStatus
  next_version: number
  settlement_hash: string
  release_journal_id: string | null
  reservation_state_updated: number
  release_journal_posted: number
  provider_mutation_allowed: number
  execution_allowed: number
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function hash(value: string, field: string): string {
  const normalized = required(value, field).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function deterministicReceiptId(fillId: string): string {
  return `reservation-settlement:${required(fillId, 'fillId')}`
}

function deterministicEventId(fillId: string): string {
  return `reservation-settlement-event:${required(fillId, 'fillId')}`
}

async function requestHash(input: PersistReservationSettlementInput): Promise<string> {
  return canonicalHash({
    reservationId: input.reservationId,
    fillId: input.fillId,
    accountingHash: input.accountingHash,
    terminalFill: input.terminalFill,
    availableAccountId: input.availableAccountId,
    reservedAccountId: input.reservedAccountId,
    releaseJournalId: input.releaseJournalId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    settledAt: input.settledAt,
  })
}

function replayResult(row: SettlementReceiptRow): PersistReservationSettlementResult {
  if (
    row.reservation_state_updated !== 1
    || row.provider_mutation_allowed !== 0
    || row.execution_allowed !== 0
    || row.release_journal_posted !== (row.release_journal_id === null ? 0 : 1)
  ) {
    throw new ReservationSettlementConflictError(
      'reservation settlement receipt violates permanent capability or journal locks',
    )
  }
  return Object.freeze({
    status: 'REPLAYED',
    settlementReceiptId: row.settlement_receipt_id,
    reservationId: row.reservation_id,
    fillId: row.fill_id,
    consumedDelta: asDecimalString(row.consumed_delta, 'receipt.consumedDelta'),
    nextConsumedAmount: asDecimalString(
      row.next_consumed_amount,
      'receipt.nextConsumedAmount',
    ),
    releasedAmount: asDecimalString(row.released_amount, 'receipt.releasedAmount'),
    nextStatus: row.next_status,
    nextVersion: row.next_version,
    settlementHash: hash(row.settlement_hash, 'receipt.settlementHash'),
    reservationStateUpdated: true,
    releaseJournalPosted: row.release_journal_posted === 1,
    providerMutationAllowed: false,
    executionAllowed: false,
  })
}

async function loadFillJournal(
  env: ReservationSettlementStoreEnv,
  journalId: string,
): Promise<LedgerJournalDraft> {
  const journal = await env.DB.prepare(`
    SELECT journal_id, exchange_account_id, event_type, reference_type,
           reference_id, correlation_id, idempotency_key, status
      FROM ledger_journals
     WHERE journal_id = ?
     LIMIT 1
  `).bind(journalId).first<JournalRow>()
  if (!journal || journal.status !== 'POSTED') {
    throw new ReservationSettlementConflictError('posted fill journal is missing')
  }

  const entries = await env.DB.prepare(`
    SELECT entry_id, ledger_account_id, asset, direction, amount
      FROM ledger_entries
     WHERE journal_id = ?
     ORDER BY entry_id ASC
  `).bind(journalId).all<JournalEntryRow>()
  if (entries.results.length < 2) {
    throw new ReservationSettlementConflictError('fill journal entries are incomplete')
  }

  return {
    journalId: journal.journal_id,
    exchangeAccountId: journal.exchange_account_id,
    eventType: journal.event_type,
    referenceType: journal.reference_type,
    referenceId: journal.reference_id,
    correlationId: journal.correlation_id,
    idempotencyKey: journal.idempotency_key,
    entries: entries.results.map((entry) => {
      if (!['DEBIT', 'CREDIT'].includes(entry.direction)) {
        throw new ReservationSettlementConflictError('fill journal direction is invalid')
      }
      return {
        entryId: entry.entry_id,
        ledgerAccountId: entry.ledger_account_id,
        asset: entry.asset,
        direction: entry.direction as LedgerDirection,
        amount: asDecimalString(entry.amount, 'journal.entry.amount'),
      }
    }),
  }
}

function releaseJournalStatements(
  env: ReservationSettlementStoreEnv,
  journal: LedgerJournalDraft | null,
): D1PreparedStatement[] {
  if (!journal) return []
  return [
    env.DB.prepare(`
      INSERT INTO ledger_journals (
        journal_id, exchange_account_id, event_type, reference_type,
        reference_id, correlation_id, idempotency_key, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED')
    `).bind(
      journal.journalId,
      journal.exchangeAccountId,
      journal.eventType,
      journal.referenceType,
      journal.referenceId,
      journal.correlationId,
      journal.idempotencyKey,
    ),
    ...journal.entries.map((entry) => env.DB.prepare(`
      INSERT INTO ledger_entries (
        entry_id, journal_id, ledger_account_id, asset, direction, amount
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      entry.entryId,
      journal.journalId,
      entry.ledgerAccountId,
      entry.asset,
      entry.direction,
      entry.amount,
    )),
  ]
}

export async function persistReservationSettlement(
  env: ReservationSettlementStoreEnv,
  input: PersistReservationSettlementInput,
): Promise<PersistReservationSettlementResult> {
  const normalized: PersistReservationSettlementInput = {
    reservationId: required(input.reservationId, 'reservationId'),
    fillId: required(input.fillId, 'fillId'),
    accountingHash: hash(input.accountingHash, 'accountingHash'),
    terminalFill: input.terminalFill,
    availableAccountId: required(input.availableAccountId, 'availableAccountId'),
    reservedAccountId: required(input.reservedAccountId, 'reservedAccountId'),
    releaseJournalId: required(input.releaseJournalId, 'releaseJournalId'),
    correlationId: required(input.correlationId, 'correlationId'),
    idempotencyKey: required(input.idempotencyKey, 'idempotencyKey'),
    settledAt: timestamp(input.settledAt, 'settledAt'),
  }
  const settlementReceiptId = deterministicReceiptId(normalized.fillId)
  const stableRequestHash = await requestHash(normalized)

  const existing = await env.DB.prepare(`
    SELECT settlement_receipt_id, request_hash, accounting_hash,
           reservation_id, fill_id, consumed_delta, next_consumed_amount,
           released_amount, next_status, next_version, settlement_hash,
           release_journal_id, reservation_state_updated,
           release_journal_posted, provider_mutation_allowed,
           execution_allowed
      FROM live_reservation_settlement_receipts
     WHERE fill_id = ?
     LIMIT 1
  `).bind(normalized.fillId).first<SettlementReceiptRow>()
  if (existing) {
    if (
      existing.settlement_receipt_id !== settlementReceiptId
      || existing.request_hash !== stableRequestHash
      || existing.accounting_hash !== normalized.accountingHash
      || existing.reservation_id !== normalized.reservationId
    ) {
      throw new ReservationSettlementConflictError(
        'reservation settlement receipt conflicts with request',
      )
    }
    return replayResult(existing)
  }

  const accounting = await env.DB.prepare(`
    SELECT internal_order_id, accounting_hash, journal_id,
           provider_mutation_allowed, reservation_applied, execution_allowed
      FROM live_fill_accounting_receipts
     WHERE fill_id = ?
     LIMIT 1
  `).bind(normalized.fillId).first<AccountingReceiptRow>()
  if (!accounting || accounting.accounting_hash !== normalized.accountingHash) {
    throw new ReservationSettlementConflictError(
      'immutable fill accounting receipt is missing or mismatched',
    )
  }
  if (
    accounting.provider_mutation_allowed !== 0
    || accounting.reservation_applied !== 0
    || accounting.execution_allowed !== 0
  ) {
    throw new ReservationSettlementConflictError(
      'fill accounting receipt violates permanent capability locks',
    )
  }

  const reservation = await env.DB.prepare(`
    SELECT reservation_id, exchange_account_id, order_id, asset,
           amount, consumed_amount, status, version
      FROM reservations
     WHERE reservation_id = ?
     LIMIT 1
  `).bind(normalized.reservationId).first<ReservationRow>()
  if (!reservation) throw new ReservationSettlementConflictError('reservation is missing')
  if (!['ACTIVE', 'PARTIALLY_CONSUMED'].includes(reservation.status)) {
    throw new ReservationSettlementConflictError('reservation is not settleable')
  }
  if (reservation.order_id !== accounting.internal_order_id) {
    throw new ReservationSettlementConflictError(
      'reservation order does not match immutable fill accounting receipt',
    )
  }

  const fillJournal = await loadFillJournal(env, accounting.journal_id)
  const plan = await buildReservationSettlementPlan({
    settlementReceiptId,
    fillId: normalized.fillId,
    accountingHash: normalized.accountingHash,
    internalOrderId: accounting.internal_order_id,
    correlationId: normalized.correlationId,
    idempotencyKey: normalized.idempotencyKey,
    settledAt: normalized.settledAt,
    terminalFill: normalized.terminalFill,
    reservation: {
      reservationId: reservation.reservation_id,
      exchangeAccountId: reservation.exchange_account_id,
      orderId: reservation.order_id,
      asset: reservation.asset,
      amount: asDecimalString(reservation.amount, 'reservation.amount'),
      consumedAmount: asDecimalString(
        reservation.consumed_amount,
        'reservation.consumedAmount',
      ),
      status: reservation.status as SettleableReservationStatus,
      version: reservation.version,
    },
    fillJournal,
    availableAccountId: normalized.availableAccountId,
    reservedAccountId: normalized.reservedAccountId,
    releaseJournalId: normalized.releaseJournalId,
  })

  const statements: D1PreparedStatement[] = [
    ...releaseJournalStatements(env, plan.releaseJournalDraft),
    env.DB.prepare(`
      UPDATE reservations
         SET consumed_amount = ?, status = ?, version = ?,
             updated_at = CURRENT_TIMESTAMP
       WHERE reservation_id = ?
         AND consumed_amount = ?
         AND status = ?
         AND version = ?
    `).bind(
      plan.nextConsumedAmount,
      plan.nextStatus,
      plan.nextVersion,
      plan.reservationId,
      plan.previousConsumedAmount,
      plan.previousStatus,
      plan.previousVersion,
    ),
    env.DB.prepare(`
      INSERT INTO live_reservation_settlement_receipts (
        settlement_receipt_id, fill_id, accounting_hash, request_hash,
        reservation_id, asset, previous_version, next_version,
        consumed_delta, previous_consumed_amount, next_consumed_amount,
        released_amount, previous_status, next_status, release_journal_id,
        settlement_hash, reservation_state_updated, release_journal_posted,
        provider_mutation_allowed, execution_allowed, settled_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0, ?)
    `).bind(
      plan.settlementReceiptId,
      plan.fillId,
      plan.accountingHash,
      stableRequestHash,
      plan.reservationId,
      plan.asset,
      plan.previousVersion,
      plan.nextVersion,
      plan.consumedDelta,
      plan.previousConsumedAmount,
      plan.nextConsumedAmount,
      plan.releasedAmount,
      plan.previousStatus,
      plan.nextStatus,
      plan.releaseJournalDraft?.journalId ?? null,
      plan.settlementHash,
      plan.releaseJournalDraft ? 1 : 0,
      normalized.settledAt,
    ),
    env.DB.prepare(`
      INSERT INTO live_reservation_settlement_events (
        settlement_event_id, settlement_receipt_id, reservation_id, fill_id,
        previous_status, next_status, previous_version, next_version,
        consumed_delta, released_amount, settlement_hash, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      deterministicEventId(plan.fillId),
      plan.settlementReceiptId,
      plan.reservationId,
      plan.fillId,
      plan.previousStatus,
      plan.nextStatus,
      plan.previousVersion,
      plan.nextVersion,
      plan.consumedDelta,
      plan.releasedAmount,
      plan.settlementHash,
      normalized.settledAt,
    ),
  ]
  await env.DB.batch(statements)

  const projected = await env.DB.prepare(`
    SELECT settlement_receipt_id, request_hash, accounting_hash,
           reservation_id, fill_id, consumed_delta, next_consumed_amount,
           released_amount, next_status, next_version, settlement_hash,
           release_journal_id, reservation_state_updated,
           release_journal_posted, provider_mutation_allowed,
           execution_allowed
      FROM live_reservation_settlement_receipts
     WHERE fill_id = ?
     LIMIT 1
  `).bind(normalized.fillId).first<SettlementReceiptRow>()
  if (!projected) throw new Error('reservation settlement receipt is missing after D1 batch')
  if (
    projected.request_hash !== stableRequestHash
    || projected.accounting_hash !== plan.accountingHash
    || projected.settlement_hash !== plan.settlementHash
    || projected.next_version !== plan.nextVersion
    || projected.next_consumed_amount !== plan.nextConsumedAmount
    || projected.next_status !== plan.nextStatus
  ) {
    throw new ReservationSettlementConflictError(
      'reservation settlement receipt verification failed',
    )
  }

  const replay = replayResult(projected)
  return Object.freeze({ ...replay, status: 'SETTLED' })
}
