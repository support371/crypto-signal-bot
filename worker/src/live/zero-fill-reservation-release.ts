import { canonicalHash } from './canonical-json.ts'
import { asDecimalString, assertPositiveDecimal, compareDecimal, sumDecimals } from './decimal.ts'
import { buildReservationReleaseJournal } from './ledger.ts'
import { OrderCompletionConflictError } from './order-completion-store.ts'

/** Run under the account queue after current ORDER_COMPLETION authorization. */
export async function releaseZeroFillReservations(
  env: { DB: D1Database }, accountId: string, orderId: string, authorizationEventId: string,
): Promise<void> {
  const conflict = (): never => { throw new OrderCompletionConflictError('zero-fill release evidence is incomplete or inconsistent') }
  const order = await env.DB.prepare(`SELECT state, pending_cancel, filled_base_quantity,
    filled_quote_value, raw_response_hash FROM live_orders WHERE internal_order_id = ?
    AND exchange_account_id = ?`).bind(orderId, accountId).first<{
      state: string; pending_cancel: number; filled_base_quantity: string;
      filled_quote_value: string | null; raw_response_hash: string | null;
    }>()
  if (!order) return conflict()
  // Filled orders use fill settlement, never this release path.
  const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM live_fills WHERE internal_order_id = ?`)
    .bind(orderId).first<{ n: number }>()
  if (count?.n !== 0) return
  const terminal = await env.DB.prepare(`SELECT event_id, next_state, source, audit_event_hash
    FROM live_order_events WHERE internal_order_id = ? AND event_id != ?
    ORDER BY sequence_id DESC LIMIT 1`).bind(orderId, `order-completion:${orderId}`).first<{
      event_id: string; next_state: string; source: string; audit_event_hash: string;
    }>()
  if (!terminal || !['CANCELLED', 'REJECTED', 'EXPIRED'].includes(terminal.next_state)
    || ![terminal.next_state, 'SETTLED'].includes(order.state) || order.pending_cancel !== 0
    || order.filled_base_quantity !== '0' || ![null, '0'].includes(order.filled_quote_value)
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
    const releaseId = `zero-fill-release:${r.reservation_id}`
    const journalId = `zero-fill-release-journal:${r.reservation_id}`
    const existing = await env.DB.prepare(`SELECT terminal_event_id, journal_id, released_amount,
      next_version, authorization_event_id, evidence_hash, provider_mutation_allowed, execution_allowed FROM live_zero_fill_reservation_releases
      WHERE reservation_id = ? AND exchange_account_id = ? AND internal_order_id = ?`)
      .bind(r.reservation_id, accountId, orderId).first<{
        terminal_event_id: string; journal_id: string; released_amount: string; next_version: number;
        authorization_event_id: string; evidence_hash: string;
        provider_mutation_allowed: number; execution_allowed: number;
      }>()
    if (existing) {
      if (r.status !== 'RELEASED' || r.consumed_amount !== '0' || existing.terminal_event_id !== terminal.event_id
        || existing.released_amount !== r.amount || existing.next_version !== r.version
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
          || e.ledger_asset !== r.asset || e.amount !== r.amount)
        || !((debit.account_type === 'CASH_AVAILABLE' && credit.account_type === 'CASH_RESERVED')
          || (debit.account_type === 'INVENTORY_AVAILABLE' && credit.account_type === 'INVENTORY_RESERVED'))) return conflict()
      const expected = buildReservationReleaseJournal({ journalId, exchangeAccountId: accountId,
        orderId, correlationId: existing.authorization_event_id, idempotencyKey: releaseId,
        asset: r.asset, amount: asDecimalString(r.amount),
        availableAccountId: debit.ledger_account_id, reservedAccountId: credit.ledger_account_id })
      if (savedJournal.exchange_account_id !== accountId || savedJournal.event_type !== expected.eventType
        || savedJournal.reference_type !== expected.referenceType || savedJournal.reference_id !== orderId
        || savedJournal.correlation_id !== expected.correlationId || savedJournal.idempotency_key !== releaseId
        || expected.entries.some((e) => !entries.some((row) => row.entry_id === e.entryId
          && row.ledger_account_id === e.ledgerAccountId && row.direction === e.direction))) return conflict()
      const expectedHash = await canonicalHash({ accountId, orderId,
        reservation: { ...r, status: 'ACTIVE', version: existing.next_version - 1 },
        terminalEventId: terminal.event_id, authorizationEventId: existing.authorization_event_id, journal: expected })
      if (existing.evidence_hash !== expectedHash) return conflict()
      continue
    }
    if (r.status !== 'ACTIVE' || r.consumed_amount !== '0' || order.state === 'SETTLED') return conflict()
    const amount = assertPositiveDecimal(asDecimalString(r.amount), 'reservation.amount')
    if (amount !== r.amount) return conflict()
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
      || compareDecimal(sumDecimals(backing.filter((e) => e.direction === 'DEBIT').map((e) => asDecimalString(e.amount))), amount) !== 0
      || compareDecimal(sumDecimals(backing.filter((e) => e.direction === 'CREDIT').map((e) => asDecimalString(e.amount))), amount) !== 0) return conflict()
    const journal = buildReservationReleaseJournal({ journalId, exchangeAccountId: accountId,
      orderId, correlationId: authorizationEventId, idempotencyKey: releaseId, asset: r.asset, amount,
      availableAccountId: available.ledger_account_id, reservedAccountId: reserved.ledger_account_id })
    const hash = await canonicalHash({ accountId, orderId, reservation: r,
      terminalEventId: terminal.event_id, authorizationEventId, journal })
    statements.push(env.DB.prepare(`INSERT INTO ledger_journals (journal_id, exchange_account_id,
      event_type, reference_type, reference_id, correlation_id, idempotency_key, status)
      VALUES (?,?,'FUNDS_RESERVATION_RELEASED','ORDER',?,?,?,'POSTED')`)
      .bind(journalId, accountId, orderId, authorizationEventId, releaseId))
    for (const e of journal.entries) statements.push(env.DB.prepare(`INSERT INTO ledger_entries
      (entry_id,journal_id,ledger_account_id,asset,direction,amount) VALUES (?,?,?,?,?,?)`)
      .bind(e.entryId, journalId, e.ledgerAccountId, e.asset, e.direction, e.amount))
    statements.push(env.DB.prepare(`UPDATE reservations SET status='RELEASED', version=version+1
      WHERE reservation_id=? AND exchange_account_id=? AND order_id=? AND status='ACTIVE'
      AND consumed_amount='0' AND version=? AND amount=? AND asset=?`)
      .bind(r.reservation_id, accountId, orderId, r.version, r.amount, r.asset))
    statements.push(env.DB.prepare(`INSERT INTO live_zero_fill_reservation_releases (release_id,
      reservation_id,exchange_account_id,internal_order_id,terminal_event_id,authorization_event_id,
      journal_id,released_amount,previous_version,next_version,evidence_hash,occurred_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(releaseId, r.reservation_id, accountId, orderId,
        terminal.event_id, authorizationEventId, journalId, amount, r.version, r.version + 1, hash,
        new Date().toISOString()))
  }
  if (statements.length) await env.DB.batch(statements)
}
