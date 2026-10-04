import { canonicalHash } from './canonical-json.ts'
import { asDecimalString, compareDecimal, sumDecimals } from './decimal.ts'
import { assertOrderTransition } from './order-state-machine.ts'
import type { OrderState } from './domain.ts'

export class OrderCompletionConflictError extends Error {
  readonly code = 'ORDER_COMPLETION_CONFLICT'
}

/** Projection finalization only. Call inside the existing account coordinator's
 * shared accounting queue, after separately authorized reservation settlement.
 * This does not infer an exchange terminal state from an accounting result. */
export async function persistCompletedOrder(
  env: { DB: D1Database }, exchangeAccountId: string, internalOrderId: string,
): Promise<{ status: 'COMPLETED' | 'REPLAYED'; eventId: string; executionAllowed: false }> {
  for (const id of [exchangeAccountId, internalOrderId]) {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(id)) throw new TypeError('invalid completion scope')
  }
  const conflict = (message: string): never => { throw new OrderCompletionConflictError(message) }
  const order = await env.DB.prepare(`SELECT * FROM live_orders WHERE internal_order_id = ?
    AND exchange_account_id = ?`).bind(internalOrderId, exchangeAccountId).first<{
      state: OrderState; settled: number; pending_cancel: number; product_id: string;
      side: string; exchange_order_id: string; filled_base_quantity: string;
      filled_quote_value: string | null; updated_at: string; configuration_version: string;
      release_id: string | null; raw_response_hash: string | null;
    }>()
  if (!order) return conflict('order does not belong to this coordinator')
  const eventId = `order-completion:${internalOrderId}`
  const previous = await env.DB.prepare(`SELECT previous_state, next_state, payload_hash FROM live_order_events
    WHERE event_id = ? AND internal_order_id = ?`).bind(eventId, internalOrderId)
    .first<{ previous_state: OrderState; next_state: string; payload_hash: string }>()
  if (previous) {
    if (order.state !== 'SETTLED' || order.settled !== 1 || previous.next_state !== 'SETTLED') {
      return conflict('completion event conflicts with order state')
    }
  }
  const terminalState = previous?.previous_state ?? order.state
  if (!['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(terminalState)
    || (!previous && order.settled !== 0) || order.pending_cancel !== 0) return conflict('exchange terminal state is required')
  assertOrderTransition(terminalState, 'SETTLED')
  const terminal = await env.DB.prepare(`SELECT sequence_id, event_id, next_state, source,
    audit_event_hash FROM live_order_events WHERE internal_order_id = ?
    AND event_id != ? ORDER BY sequence_id DESC LIMIT 1`).bind(internalOrderId, eventId).first<{
      sequence_id: number; event_id: string; next_state: string; source: string; audit_event_hash: string;
    }>()
  if (!terminal || terminal.next_state !== terminalState
    || !['exchange-rest', 'exchange-websocket', 'reconciliation'].includes(terminal.source)
    || !/^[a-f0-9]{64}$/.test(terminal.audit_event_hash)
    || !order.raw_response_hash || !/^[a-f0-9]{64}$/.test(order.raw_response_hash)) {
    return conflict('persisted terminal observation and audit reference are required')
  }
  const reservations = (await env.DB.prepare(`SELECT reservation_id, status, version FROM reservations
    WHERE order_id = ? AND exchange_account_id = ?`).bind(internalOrderId, exchangeAccountId)
    .all<{ reservation_id: string; status: string; version: number }>()).results
  // CANCELLED alone does not prove a posted remainder release.
  if (reservations.some((r) => !['CONSUMED', 'RELEASED'].includes(r.status))) {
    return conflict('reservation completion is required')
  }
  const fills = (await env.DB.prepare(`SELECT f.fill_id, f.exchange_account_id,
    f.exchange_order_id, f.product_id, f.side, f.base_size, f.quote_value,
    a.accounting_hash, a.exchange_account_id AS accounting_account,
    a.internal_order_id AS accounting_order, a.product_id AS accounting_product,
    a.provider_mutation_allowed, a.reservation_applied, a.execution_allowed,
    s.accounting_hash AS settlement_accounting_hash, s.reservation_id,
    s.execution_allowed AS settlement_execution, s.provider_mutation_allowed AS settlement_mutation,
    r.order_id AS reservation_order, r.exchange_account_id AS reservation_account
    FROM live_fills f LEFT JOIN live_fill_accounting_receipts a ON a.fill_id = f.fill_id
    LEFT JOIN live_reservation_settlement_receipts s ON s.fill_id = f.fill_id
    LEFT JOIN reservations r ON r.reservation_id = s.reservation_id
    WHERE f.internal_order_id = ? ORDER BY f.fill_id LIMIT 1001`)
    .bind(internalOrderId).all<Record<string, string | number | null>>()).results
  if (fills.length > 1000) return conflict('completion evidence exceeds bounded fill scope')
  for (const f of fills) {
    if (f.exchange_account_id !== exchangeAccountId || f.accounting_account !== exchangeAccountId
      || f.accounting_order !== internalOrderId || f.product_id !== order.product_id
      || f.accounting_product !== order.product_id || f.side !== order.side
      || f.exchange_order_id !== order.exchange_order_id || !f.accounting_hash
      || f.accounting_hash !== f.settlement_accounting_hash
      || f.reservation_order !== internalOrderId || f.reservation_account !== exchangeAccountId
      || f.provider_mutation_allowed !== 0 || f.reservation_applied !== 0 || f.execution_allowed !== 0
      || f.settlement_execution !== 0 || f.settlement_mutation !== 0) {
      return conflict('every fill requires matching accounting and reservation evidence')
    }
  }
  const base = sumDecimals(fills.map((f) => asDecimalString(String(f.base_size))))
  const quote = sumDecimals(fills.map((f) => asDecimalString(String(f.quote_value))))
  if (compareDecimal(base, asDecimalString(order.filled_base_quantity)) !== 0
    || compareDecimal(quote, asDecimalString(order.filled_quote_value ?? '0')) !== 0) {
    return conflict('exchange totals do not match accounted fills')
  }
  if (terminalState === 'FILLED' && compareDecimal(base, asDecimalString('0')) <= 0) {
    return conflict('a filled order requires positive accounted quantity')
  }
  const payloadHash = await canonicalHash({ exchangeAccountId, internalOrderId,
    terminalEventId: terminal.event_id, terminalAuditHash: terminal.audit_event_hash,
    rawResponseHash: order.raw_response_hash, reservations, fills, base, quote })
  if (previous) {
    if (previous.payload_hash !== payloadHash) return conflict('completion evidence changed after commit')
    return { status: 'REPLAYED', eventId, executionAllowed: false }
  }
  const occurredAt = new Date().toISOString()
  // Recheck mutable facts in the transaction. changes() binds event insertion to
  // this exact successful UPDATE rather than a pre-existing settled row.
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE live_orders SET state = 'SETTLED', settled = 1, updated_at = ?
      WHERE internal_order_id = ? AND exchange_account_id = ? AND state = ? AND settled = 0
      AND pending_cancel = 0 AND updated_at = ? AND filled_base_quantity = ?
      AND filled_quote_value IS ? AND raw_response_hash = ?
      AND (SELECT MAX(sequence_id) FROM live_order_events WHERE internal_order_id = ?) = ?
      AND (SELECT COUNT(*) FROM live_fills WHERE internal_order_id = ?) = ?
      AND NOT EXISTS (SELECT 1 FROM reservations WHERE order_id = ?
        AND status NOT IN ('CONSUMED','RELEASED'))`)
      .bind(occurredAt, internalOrderId, exchangeAccountId, order.state, order.updated_at,
        order.filled_base_quantity, order.filled_quote_value, order.raw_response_hash,
        internalOrderId, terminal.sequence_id, internalOrderId, fills.length, internalOrderId),
    env.DB.prepare(`INSERT INTO live_order_events (event_id, internal_order_id, previous_state,
      next_state, source, source_event_id, correlation_id, release_id, configuration_version,
      payload_hash, audit_event_hash, occurred_at)
      SELECT ?, ?, ?, 'SETTLED', 'system', ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(eventId, internalOrderId, order.state, eventId, terminal.event_id, order.release_id,
        order.configuration_version, payloadHash, terminal.audit_event_hash, occurredAt),
  ])
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) {
    return conflict('order changed before completion commit')
  }
  return { status: 'COMPLETED', eventId, executionAllowed: false }
}
