import { canonicalHash } from './canonical-json.ts'
import { asDecimalString, assertPositiveDecimal, compareDecimal, sumDecimals, subtractNonNegativeDecimal } from './decimal.ts'
import { buildReservationReleaseJournal } from './ledger.ts'
import { OrderCompletionConflictError } from './order-completion-store.ts'

/** Run under the account queue after current ORDER_COMPLETION authorization. */
export async function releasePartialFillRemainder(
  env: { DB: D1Database }, accountId: string, orderId: string, authorizationEventId: string,
): Promise<void> {
  const conflict = (): never => { throw new OrderCompletionConflictError('partial-fill release evidence is incomplete or inconsistent') }
  const order = await env.DB.prepare(`SELECT state, pending_cancel, filled_base_quantity,
    filled_quote_value, raw_response_hash, product_id, side, exchange_order_id FROM live_orders WHERE internal_order_id = ?
    AND exchange_account_id = ?`).bind(orderId, accountId).first<{
      state: string; pending_cancel: number; filled_base_quantity: string;
      filled_quote_value: string | null; raw_response_hash: string | null;
      product_id: string; side: string; exchange_order_id: string;
    }>()
  if (!order) return conflict()
  const fills = (await env.DB.prepare(`SELECT f.fill_id, f.base_size, f.quote_value,
    f.exchange_account_id, f.product_id, f.side, f.exchange_order_id,
    a.accounting_hash, a.exchange_account_id AS accounting_account, a.internal_order_id AS accounting_order,
    a.product_id AS accounting_product, a.provider_mutation_allowed, a.reservation_applied, a.execution_allowed,
    j.status AS journal_status, j.reference_type, j.reference_id, j.exchange_account_id AS journal_account,
    ss.accounting_hash AS settled_accounting_hash, ss.reservation_id, ss.consumed_delta,
    ss.provider_mutation_allowed AS settlement_mutation, ss.execution_allowed AS settlement_execution,
    ss.reservation_state_updated, ss.release_journal_posted, ss.release_journal_id,
    ss.next_status AS settlement_next_status, ss.next_version AS settlement_next_version,
    ss.next_consumed_amount AS settlement_consumed_amount,
    sj.status AS release_status, sj.exchange_account_id AS release_account,
    rr.exchange_account_id AS reservation_account, rr.order_id AS reservation_order
    FROM live_fills f LEFT JOIN live_fill_accounting_receipts a ON a.fill_id=f.fill_id
    LEFT JOIN ledger_journals j ON j.journal_id=a.journal_id
    LEFT JOIN live_reservation_settlement_receipts ss ON ss.fill_id=f.fill_id
    LEFT JOIN ledger_journals sj ON sj.journal_id=ss.release_journal_id
    LEFT JOIN reservations rr ON rr.reservation_id=ss.reservation_id
    WHERE f.internal_order_id=? ORDER BY f.fill_id LIMIT 1001`)
    .bind(orderId).all<Record<string, string | number | null>>()).results
  if (!fills.length) return
  if (fills.length > 1000 || fills.some((f) => f.exchange_account_id !== accountId
    || f.product_id !== order.product_id || f.side !== order.side || f.exchange_order_id !== order.exchange_order_id
    || f.accounting_account !== accountId || f.accounting_order !== orderId
    || f.accounting_product !== order.product_id || !f.accounting_hash
    || f.accounting_hash !== f.settled_accounting_hash || f.provider_mutation_allowed !== 0
    || f.reservation_applied !== 0 || f.execution_allowed !== 0 || f.settlement_mutation !== 0
    || f.settlement_execution !== 0 || f.reservation_state_updated !== 1 || f.journal_status !== 'POSTED'
    || f.reference_type !== 'FILL' || f.reference_id !== f.fill_id || f.journal_account !== accountId
    || f.reservation_account !== accountId || f.reservation_order !== orderId
    || !(f.release_journal_posted === 0 && f.release_journal_id === null
      || f.release_journal_posted === 1 && f.release_status === 'POSTED' && f.release_account === accountId))) return conflict()
  const filledBase = sumDecimals(fills.map((f) => asDecimalString(String(f.base_size))))
  const filledQuote = sumDecimals(fills.map((f) => asDecimalString(String(f.quote_value))))
  if (compareDecimal(filledBase, asDecimalString(order.filled_base_quantity)) !== 0
    || compareDecimal(filledQuote, asDecimalString(order.filled_quote_value ?? '0')) !== 0) return conflict()
  const terminal = await env.DB.prepare(`SELECT event_id, next_state, source, audit_event_hash
    FROM live_order_events WHERE internal_order_id = ? AND event_id != ?
    ORDER BY sequence_id DESC LIMIT 1`).bind(orderId, `order-completion:${orderId}`).first<{
      event_id: string; next_state: string; source: string; audit_event_hash: string;
    }>()
  if (!terminal || !['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(terminal.next_state)
    || ![terminal.next_state, 'SETTLED'].includes(order.state) || order.pending_cancel !== 0
    || !['exchange-rest', 'exchange-websocket', 'reconciliation'].includes(terminal.source)
    || !/^[a-f0-9]{64}$/.test(terminal.audit_event_hash)
    || !order.raw_response_hash || !/^[a-f0-9]{64}$/.test(order.raw_response_hash)) return conflict()
  const reservations = (await env.DB.prepare(`SELECT reservation_id, asset, amount, consumed_amount,
    status, version FROM reservations WHERE order_id = ? AND exchange_account_id = ?
    ORDER BY reservation_id LIMIT 21`).bind(orderId, accountId).all<{
      reservation_id: string; asset: string; amount: string; consumed_amount: string;
      status: string; version: number;
    }>()).results
  if (reservations.length > 20) return conflict()
  const statements: D1PreparedStatement[] = []
  for (const r of reservations) {
    const releaseId = `partial-fill-release:${r.reservation_id}`
    const journalId = `partial-fill-release-journal:${r.reservation_id}`
    const existing = await env.DB.prepare(`SELECT terminal_event_id, journal_id, released_amount,
      next_version, consumed_amount, authorization_event_id, evidence_hash, provider_mutation_allowed, execution_allowed FROM live_partial_fill_reservation_releases
      WHERE reservation_id = ? AND exchange_account_id = ? AND internal_order_id = ?`)
      .bind(r.reservation_id, accountId, orderId).first<{
        terminal_event_id: string; journal_id: string; released_amount: string; next_version: number;
        authorization_event_id: string; evidence_hash: string; consumed_amount: string;
        provider_mutation_allowed: number; execution_allowed: number;
      }>()
    if (existing) {
      const remaining = subtractNonNegativeDecimal(asDecimalString(r.amount), asDecimalString(r.consumed_amount))
      if (r.status !== 'RELEASED' || existing.consumed_amount !== r.consumed_amount || existing.terminal_event_id !== terminal.event_id
        || existing.released_amount !== remaining || existing.next_version !== r.version
        || existing.journal_id !== journalId || existing.provider_mutation_allowed !== 0
        || existing.execution_allowed !== 0) return conflict()
      const savedJournal = await env.DB.prepare(`SELECT journal_id, exchange_account_id, event_type,
        reference_type, reference_id, correlation_id, idempotency_key, status FROM ledger_journals
        WHERE journal_id = ?`).bind(journalId).first<{
          journal_id: string; exchange_account_id: string; event_type: string; reference_type: string;
          reference_id: string; correlation_id: string; idempotency_key: string; status: string;
        }>()
      const entries = (await env.DB.prepare(`SELECT e.entry_id, e.ledger_account_id, e.asset,
        e.direction, e.amount, a.exchange_account_id, a.asset AS ledger_asset, a.account_type
        FROM ledger_entries e JOIN ledger_accounts a ON a.ledger_account_id=e.ledger_account_id
        WHERE e.journal_id = ? ORDER BY e.entry_id`).bind(journalId).all<{
          entry_id: string; ledger_account_id: string; asset: string; direction: string; amount: string;
          exchange_account_id: string; ledger_asset: string; account_type: string;
        }>()).results
      const debit = entries.find((e) => e.direction === 'DEBIT')
      const credit = entries.find((e) => e.direction === 'CREDIT')
      if (!savedJournal || savedJournal.status !== 'POSTED' || entries.length !== 2 || !debit || !credit
        || entries.some((e) => e.exchange_account_id !== accountId || e.asset !== r.asset
          || e.ledger_asset !== r.asset || e.amount !== remaining)
        || !((debit.account_type === 'CASH_AVAILABLE' && credit.account_type === 'CASH_RESERVED')
          || (debit.account_type === 'INVENTORY_AVAILABLE' && credit.account_type === 'INVENTORY_RESERVED'))) return conflict()
      const expected = buildReservationReleaseJournal({ journalId, exchangeAccountId: accountId,
        orderId, correlationId: existing.authorization_event_id, idempotencyKey: releaseId,
        asset: r.asset, amount: remaining,
        availableAccountId: debit.ledger_account_id, reservedAccountId: credit.ledger_account_id })
      if (savedJournal.exchange_account_id !== accountId || savedJournal.event_type !== expected.eventType
        || savedJournal.reference_type !== expected.referenceType || savedJournal.reference_id !== orderId
        || savedJournal.correlation_id !== expected.correlationId || savedJournal.idempotency_key !== releaseId
        || expected.entries.some((e) => !entries.some((row) => row.entry_id === e.entryId
          && row.ledger_account_id === e.ledgerAccountId && row.direction === e.direction))) return conflict()
      const expectedHash = await canonicalHash({ accountId, orderId,
        reservation: { ...r, status: 'PARTIALLY_CONSUMED', version: existing.next_version - 1 },
        terminalEventId: terminal.event_id, authorizationEventId: existing.authorization_event_id, fills, journal: expected })
      if (existing.evidence_hash !== expectedHash) return conflict()
      continue
    }
    if (['CONSUMED','RELEASED'].includes(r.status)) {
      const receipts = fills.filter((f) => f.reservation_id === r.reservation_id)
      if (compareDecimal(sumDecimals(receipts.map((f) => asDecimalString(String(f.consumed_delta)))),
        asDecimalString(r.consumed_amount)) !== 0
        || !receipts.some((f) => f.settlement_next_status === r.status
          && f.settlement_next_version === r.version && f.settlement_consumed_amount === r.consumed_amount
          && (r.status === 'CONSUMED' && r.amount === r.consumed_amount
            || r.status === 'RELEASED' && f.release_journal_posted === 1 && f.release_status === 'POSTED'))) return conflict()
      continue
    }
    if (r.status !== 'PARTIALLY_CONSUMED' || order.state === 'SETTLED') return conflict()
    const reservedAmount = assertPositiveDecimal(asDecimalString(r.amount), 'reservation.amount')
    const consumed = assertPositiveDecimal(asDecimalString(r.consumed_amount), 'reservation.consumedAmount')
    const amount = assertPositiveDecimal(subtractNonNegativeDecimal(reservedAmount, consumed), 'release.amount')
    if (reservedAmount !== r.amount || consumed !== r.consumed_amount
      || compareDecimal(sumDecimals(fills.filter((f) => f.reservation_id === r.reservation_id)
        .map((f) => asDecimalString(String(f.consumed_delta)))), consumed) !== 0) return conflict()
    const ledgers = (await env.DB.prepare(`SELECT ledger_account_id, account_type FROM ledger_accounts
      WHERE exchange_account_id = ? AND asset = ? AND status = 'ACTIVE'
      AND account_type IN ('CASH_AVAILABLE','CASH_RESERVED','INVENTORY_AVAILABLE','INVENTORY_RESERVED')`)
      .bind(accountId, r.asset).all<{ ledger_account_id: string; account_type: string }>()).results
    const cash = ledgers.find((l) => l.account_type === 'CASH_RESERVED')
    const reserved = cash ?? ledgers.find((l) => l.account_type === 'INVENTORY_RESERVED')
    const available = ledgers.find((l) => l.account_type === (cash ? 'CASH_AVAILABLE' : 'INVENTORY_AVAILABLE'))
    if (!reserved || !available || (cash && ledgers.some((l) => l.account_type === 'INVENTORY_RESERVED'))) return conflict()
    const backing = (await env.DB.prepare(`SELECT e.amount, e.direction, e.ledger_account_id,
      a.exchange_account_id, a.asset, a.account_type FROM ledger_entries e
      JOIN ledger_journals j ON j.journal_id=e.journal_id
      JOIN ledger_accounts a ON a.ledger_account_id=e.ledger_account_id
      WHERE j.exchange_account_id=? AND j.reference_type='ORDER' AND j.reference_id=?
        AND j.event_type='FUNDS_RESERVED' AND j.status='POSTED' AND e.asset=? LIMIT 101`)
      .bind(accountId, orderId, r.asset).all<{ amount: string; direction: string; ledger_account_id: string;
        exchange_account_id: string; asset: string; account_type: string }>()).results
    if (!backing.length || backing.length > 100 || backing.some((e) => e.exchange_account_id !== accountId
      || e.asset !== r.asset || !((e.direction === 'DEBIT' && e.ledger_account_id === reserved.ledger_account_id)
        || (e.direction === 'CREDIT' && e.ledger_account_id === available.ledger_account_id)))
      || compareDecimal(sumDecimals(backing.filter((e) => e.direction === 'DEBIT').map((e) => asDecimalString(e.amount))), reservedAmount) !== 0
      || compareDecimal(sumDecimals(backing.filter((e) => e.direction === 'CREDIT').map((e) => asDecimalString(e.amount))), reservedAmount) !== 0) return conflict()
    const journal = buildReservationReleaseJournal({ journalId, exchangeAccountId: accountId,
      orderId, correlationId: authorizationEventId, idempotencyKey: releaseId, asset: r.asset, amount,
      availableAccountId: available.ledger_account_id, reservedAccountId: reserved.ledger_account_id })
    const hash = await canonicalHash({ accountId, orderId, reservation: r,
      terminalEventId: terminal.event_id, authorizationEventId, fills, journal })
    statements.push(env.DB.prepare(`INSERT INTO ledger_journals (journal_id, exchange_account_id,
      event_type, reference_type, reference_id, correlation_id, idempotency_key, status)
      VALUES (?,?,'FUNDS_RESERVATION_RELEASED','ORDER',?,?,?,'POSTED')`)
      .bind(journalId, accountId, orderId, authorizationEventId, releaseId))
    for (const e of journal.entries) statements.push(env.DB.prepare(`INSERT INTO ledger_entries
      (entry_id,journal_id,ledger_account_id,asset,direction,amount) VALUES (?,?,?,?,?,?)`)
      .bind(e.entryId, journalId, e.ledgerAccountId, e.asset, e.direction, e.amount))
    statements.push(env.DB.prepare(`UPDATE reservations SET status='RELEASED', version=version+1
      WHERE reservation_id=? AND exchange_account_id=? AND order_id=? AND status='PARTIALLY_CONSUMED'
      AND consumed_amount=? AND version=? AND amount=? AND asset=?`)
      .bind(r.reservation_id, accountId, orderId, consumed, r.version, r.amount, r.asset))
    statements.push(env.DB.prepare(`INSERT INTO live_partial_fill_reservation_releases (release_id,
      reservation_id,exchange_account_id,internal_order_id,terminal_event_id,authorization_event_id,
      journal_id,released_amount,previous_version,next_version,evidence_hash,occurred_at,consumed_amount,filled_base_quantity,filled_quote_value,fill_count,reserved_amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(releaseId, r.reservation_id, accountId, orderId,
        terminal.event_id, authorizationEventId, journalId, amount, r.version, r.version + 1, hash,
        new Date().toISOString(), consumed, order.filled_base_quantity, order.filled_quote_value, fills.length, r.amount))
  }
  if (statements.length) await env.DB.batch(statements)
}
