import { asDecimalString, compareDecimal, sumDecimals } from './decimal.ts'
import { assertCurrentOrderProjectionAuthorization } from './order-completion-authorization.ts'
import { persistReservationSettlement, ReservationSettlementConflictError } from './reservation-settlement-store.ts'

/** Run only inside the existing account accounting queue. No caller amounts,
 * ledger IDs, terminal flag or timestamp can become financial authority. */
export async function settleReviewedFill(env: { DB: D1Database }, accountId: string,
  fillId: string, authorizationEventId: string) {
  const conflict = (): never => { throw new ReservationSettlementConflictError('reviewed settlement evidence is unavailable') }
  const fill = await env.DB.prepare(`SELECT f.internal_order_id, f.exchange_account_id, f.product_id,
    f.side, f.exchange_order_id, a.accounting_hash, a.exchange_account_id AS accounting_account,
    a.internal_order_id AS accounting_order, a.product_id AS accounting_product,
    a.provider_mutation_allowed, a.reservation_applied, a.execution_allowed,
    o.product_id AS order_product, o.side AS order_side, o.exchange_order_id AS order_native_id,
    j.status AS journal_status, j.reference_type, j.reference_id, j.exchange_account_id AS journal_account
    FROM live_fills f JOIN live_orders o ON o.internal_order_id=f.internal_order_id
    JOIN live_fill_accounting_receipts a ON a.fill_id=f.fill_id
    JOIN ledger_journals j ON j.journal_id=a.journal_id
    WHERE f.fill_id=? AND o.exchange_account_id=?`)
    .bind(fillId, accountId).first<Record<string, string | number>>()
  if (!fill || fill.exchange_account_id !== accountId || fill.accounting_account !== accountId
    || fill.accounting_order !== fill.internal_order_id || fill.accounting_product !== fill.product_id
    || fill.order_product !== fill.product_id || fill.order_side !== fill.side
    || fill.order_native_id !== fill.exchange_order_id || fill.journal_account !== accountId
    || fill.journal_status !== 'POSTED' || fill.reference_type !== 'FILL' || fill.reference_id !== fillId
    || fill.provider_mutation_allowed !== 0 || fill.reservation_applied !== 0 || fill.execution_allowed !== 0) return conflict()
  await assertCurrentOrderProjectionAuthorization(env, accountId, String(fill.internal_order_id),
    authorizationEventId, new Date().toISOString(), 'ORDER_RESERVATION_SETTLEMENT')
  const reservations = (await env.DB.prepare(`SELECT reservation_id, asset, amount FROM reservations
    WHERE order_id=? AND exchange_account_id=? ORDER BY reservation_id LIMIT 2`)
    .bind(fill.internal_order_id, accountId).all<{ reservation_id: string; asset: string; amount: string }>()).results
  // Multiple reserves need a reviewed allocation plan; never choose one by sort order.
  if (reservations.length !== 1) return conflict()
  const reservation = reservations[0]
  const ledgers = (await env.DB.prepare(`SELECT ledger_account_id, account_type FROM ledger_accounts
    WHERE exchange_account_id=? AND asset=? AND status='ACTIVE'
      AND account_type IN ('CASH_AVAILABLE','CASH_RESERVED','INVENTORY_AVAILABLE','INVENTORY_RESERVED')
    ORDER BY ledger_account_id LIMIT 5`).bind(accountId, reservation.asset)
    .all<{ ledger_account_id: string; account_type: string }>()).results
  if (ledgers.length !== 2) return conflict()
  const available = ledgers.find((l) => l.account_type.endsWith('_AVAILABLE'))
  const reserved = ledgers.find((l) => l.account_type.endsWith('_RESERVED'))
  if (!available || !reserved || available.account_type.split('_')[0] !== reserved.account_type.split('_')[0]) return conflict()
  const backing = (await env.DB.prepare(`SELECT e.amount, e.direction, e.ledger_account_id
    FROM ledger_entries e JOIN ledger_journals j ON j.journal_id=e.journal_id
    WHERE j.exchange_account_id=? AND j.reference_type='ORDER' AND j.reference_id=?
      AND j.event_type='FUNDS_RESERVED' AND j.status='POSTED' AND e.asset=?
      AND e.ledger_account_id IN (?,?) LIMIT 101`)
    .bind(accountId,fill.internal_order_id,reservation.asset,available.ledger_account_id,reserved.ledger_account_id)
    .all<{ amount:string; direction:string; ledger_account_id:string }>()).results
  if (backing.length>100 || !backing.length
    || backing.some((e)=>e.direction !== (e.ledger_account_id===reserved.ledger_account_id?'DEBIT':'CREDIT'))
    || ['DEBIT','CREDIT'].some((direction)=>compareDecimal(sumDecimals(backing.filter((e)=>e.direction===direction)
      .map((e)=>asDecimalString(e.amount))),asDecimalString(reservation.amount))!==0)) return conflict()
  const receipt = await env.DB.prepare(`SELECT settled_at, release_journal_id FROM live_reservation_settlement_receipts
    WHERE fill_id=?`).bind(fillId).first<{ settled_at: string; release_journal_id: string | null }>()
  const review = await env.DB.prepare(`SELECT occurred_at FROM live_authorization_events WHERE authorization_event_id=?`)
    .bind(authorizationEventId).first<{ occurred_at: string }>()
  if (!review || receipt?.release_journal_id) return conflict()
  return persistReservationSettlement(env, { reservationId: reservation.reservation_id, fillId,
    accountingHash: String(fill.accounting_hash), terminalFill: false,
    availableAccountId: available.ledger_account_id, reservedAccountId: reserved.ledger_account_id,
    releaseJournalId: `reviewed-fill-release:${fillId}`, correlationId: `reviewed-fill-settlement:${fillId}`,
    idempotencyKey: `reviewed-fill-settlement:${fillId}`, settledAt: receipt?.settled_at ?? review.occurred_at })
}
