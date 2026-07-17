import {
  FillAccountingConflictError,
  persistSpotFillAccountingFifo,
  type FillAccountingStoreEnv,
  type PersistSpotFillAccountingInput,
  type PersistSpotFillAccountingResult,
} from './fill-accounting-store.ts'

export interface VerifiedFillAccountingResult extends PersistSpotFillAccountingResult {
  replayStateVerified: boolean
}

type ReceiptPresenceRow = {
  accounting_receipt_id: string
}

type JournalPresenceRow = {
  journal_id: string
}

type ReceiptReplayRow = {
  accounting_receipt_id: string
  accounting_hash: string
  journal_id: string
  position_quantity: string
  cumulative_realized_pnl_quote: string
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function deterministicReceiptId(fillId: string): string {
  return `fill-accounting-receipt:${required(fillId, 'fill.fillId')}`
}

function deterministicJournalId(fillId: string): string {
  return `fill-accounting-journal:${required(fillId, 'fill.fillId')}`
}

async function assertNoOrphanedJournal(
  env: FillAccountingStoreEnv,
  fillId: string,
): Promise<void> {
  const receipt = await env.DB.prepare(`
    SELECT accounting_receipt_id
      FROM live_fill_accounting_receipts
     WHERE fill_id = ?
     LIMIT 1
  `).bind(fillId).first<ReceiptPresenceRow>()
  if (receipt) return

  const journalId = deterministicJournalId(fillId)
  const journal = await env.DB.prepare(`
    SELECT journal_id
      FROM ledger_journals
     WHERE journal_id = ?
     LIMIT 1
  `).bind(journalId).first<JournalPresenceRow>()
  if (journal) {
    throw new FillAccountingConflictError(
      'orphaned fill-accounting journal exists without an immutable receipt',
    )
  }
}

async function verifiedReplayState(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
  result: PersistSpotFillAccountingResult,
): Promise<VerifiedFillAccountingResult> {
  if (result.status !== 'REPLAYED') {
    return Object.freeze({ ...result, replayStateVerified: false })
  }

  const receipt = await env.DB.prepare(`
    SELECT accounting_receipt_id, accounting_hash, journal_id,
           position_quantity, cumulative_realized_pnl_quote,
           provider_mutation_allowed, reservation_applied, execution_allowed
      FROM live_fill_accounting_receipts
     WHERE fill_id = ?
     LIMIT 1
  `).bind(input.fill.fillId).first<ReceiptReplayRow>()

  if (!receipt) {
    throw new FillAccountingConflictError(
      'replayed fill accounting receipt disappeared during verification',
    )
  }
  if (
    receipt.accounting_receipt_id !== deterministicReceiptId(input.fill.fillId)
    || receipt.accounting_receipt_id !== result.accountingReceiptId
    || receipt.accounting_hash !== result.accountingHash
    || receipt.journal_id !== result.journalId
    || receipt.position_quantity !== result.positionQuantity
    || receipt.cumulative_realized_pnl_quote !== result.cumulativeRealizedPnlQuote
  ) {
    throw new FillAccountingConflictError(
      'replayed accounting result does not match the immutable receipt',
    )
  }
  if (
    receipt.provider_mutation_allowed !== 0
    || receipt.reservation_applied !== 0
    || receipt.execution_allowed !== 0
  ) {
    throw new FillAccountingConflictError(
      'replayed accounting receipt violates the permanent capability locks',
    )
  }

  return Object.freeze({
    ...result,
    replayStateVerified: true,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export async function persistSpotFillAccountingVerified(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
): Promise<VerifiedFillAccountingResult> {
  const fillId = required(input.fill.fillId, 'fill.fillId')
  await assertNoOrphanedJournal(env, fillId)
  const result = await persistSpotFillAccountingFifo(env, input)
  return verifiedReplayState(env, input, result)
}
