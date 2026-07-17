import {
  FillAccountingConflictError,
  persistSpotFillAccountingFifo,
  type FillAccountingStoreEnv,
  type PersistSpotFillAccountingInput,
  type PersistSpotFillAccountingResult,
} from './fill-accounting-store.ts'
import {
  asDecimalString,
  asSignedDecimalString,
} from './decimal.ts'

export interface VerifiedFillAccountingResult extends PersistSpotFillAccountingResult {
  replayStateVerified: boolean
}

type ReceiptPresenceRow = {
  accounting_receipt_id: string
}

type JournalPresenceRow = {
  journal_id: string
}

type PositionReplayRow = {
  quantity: string
  cumulative_realized_pnl_quote: string
  last_accounting_hash: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
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

  const position = await env.DB.prepare(`
    SELECT quantity, cumulative_realized_pnl_quote, last_accounting_hash
      FROM live_position_accounting
     WHERE exchange_account_id = ? AND product_id = ?
     LIMIT 1
  `).bind(
    input.exchangeAccountId,
    input.fill.productId,
  ).first<PositionReplayRow>()

  if (!position) {
    throw new FillAccountingConflictError(
      'fill accounting receipt exists without a position accounting projection',
    )
  }
  if (position.last_accounting_hash !== result.accountingHash) {
    throw new FillAccountingConflictError(
      'replayed position accounting hash does not match the immutable receipt',
    )
  }

  return Object.freeze({
    ...result,
    positionQuantity: asDecimalString(position.quantity, 'position.quantity'),
    cumulativeRealizedPnlQuote: asSignedDecimalString(
      position.cumulative_realized_pnl_quote,
      'position.cumulativeRealizedPnlQuote',
    ),
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
