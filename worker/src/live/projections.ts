import { canonicalJson } from './canonical-json.ts'
import {
  addDecimal,
  multiplyDecimal,
  type DecimalString,
} from './decimal.ts'
import type {
  ExchangeAccountBalance,
  ExchangeFillSnapshot,
  ExchangeOrderSnapshot,
  ExchangeProduct,
} from './exchange-contracts.ts'
import type { OrderEvent, OrderState } from './domain.ts'
import { assertOrderTransition } from './order-state-machine.ts'

export interface ProjectionEnv {
  DB: D1Database
}

export interface ExchangeAccountProjectionInput {
  exchangeAccountId: string
  exchangeName: string
  externalAccountRefHash: string
  status: 'DISCONNECTED' | 'READ_ONLY' | 'READY' | 'RESTRICTED' | 'HALTED' | 'CLOSED'
  eligible: boolean
  reconciliationClear: boolean
  lastReconciledAt: string | null
}

export interface OrderProjectionInput {
  internalOrderId: string
  exchangeAccountId: string
  snapshot: ExchangeOrderSnapshot
  state: OrderState
  riskDecisionId: string | null
  releaseId: string | null
  configurationVersion: string
  feeAsset: string | null
  rawResponseHash: string | null
}

export interface FillProjectionInput {
  exchangeAccountId: string
  internalOrderId: string
  fill: ExchangeFillSnapshot
  rawResponseHash: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function hash(value: string | null, field: string, requiredValue = false): string | null {
  if (value === null || value.trim() === '') {
    if (requiredValue) throw new TypeError(`${field} is required`)
    return null
  }
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function iso(value: string | null, field: string): string | null {
  if (value === null) return null
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(value).toISOString()
}

function bit(value: boolean): number {
  return value ? 1 : 0
}

export async function upsertExchangeAccountProjection(
  env: ProjectionEnv,
  input: ExchangeAccountProjectionInput,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO live_exchange_accounts (
       exchange_account_id, exchange_name, external_account_ref_hash, status,
       eligible, reconciliation_clear, last_reconciled_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(exchange_account_id) DO UPDATE SET
       exchange_name = excluded.exchange_name,
       external_account_ref_hash = excluded.external_account_ref_hash,
       status = excluded.status,
       eligible = excluded.eligible,
       reconciliation_clear = excluded.reconciliation_clear,
       last_reconciled_at = excluded.last_reconciled_at`,
  ).bind(
    required(input.exchangeAccountId, 'exchangeAccountId'),
    required(input.exchangeName, 'exchangeName'),
    required(input.externalAccountRefHash, 'externalAccountRefHash'),
    input.status,
    bit(input.eligible),
    bit(input.reconciliationClear),
    iso(input.lastReconciledAt, 'lastReconciledAt'),
  ).run()
}

export async function upsertProductProjection(
  env: ProjectionEnv,
  exchangeName: string,
  product: ExchangeProduct,
  rawResponseHash: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO live_products (
       exchange_name, product_id, base_asset, quote_asset, status,
       trading_enabled, cancel_only, limit_only, post_only, price,
       product_rules_json, raw_response_hash, observed_at, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(exchange_name, product_id) DO UPDATE SET
       base_asset = excluded.base_asset,
       quote_asset = excluded.quote_asset,
       status = excluded.status,
       trading_enabled = excluded.trading_enabled,
       cancel_only = excluded.cancel_only,
       limit_only = excluded.limit_only,
       post_only = excluded.post_only,
       price = excluded.price,
       product_rules_json = excluded.product_rules_json,
       raw_response_hash = excluded.raw_response_hash,
       observed_at = excluded.observed_at,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    required(exchangeName, 'exchangeName'),
    product.productId,
    product.baseAsset,
    product.quoteAsset,
    product.status,
    bit(product.tradingEnabled),
    bit(product.cancelOnly),
    bit(product.limitOnly),
    bit(product.postOnly),
    product.price,
    canonicalJson(product.rules),
    hash(rawResponseHash, 'rawResponseHash', true),
    product.rules.observedAt,
    product.rules.expiresAt,
  ).run()
}

function orderStatement(env: ProjectionEnv, input: OrderProjectionInput): D1PreparedStatement {
  const snapshot = input.snapshot
  if ((snapshot.requestedBaseQuantity === null) === (snapshot.requestedQuoteNotional === null)) {
    throw new TypeError('exactly one requested order sizing basis is required')
  }

  return env.DB.prepare(
    `INSERT INTO live_orders (
       internal_order_id, exchange_account_id, exchange_order_id, client_order_id,
       product_id, side, order_type, state, requested_base_quantity,
       requested_quote_notional, filled_base_quantity, filled_quote_value,
       remaining_base_quantity, average_fill_price, total_fees, fee_asset,
       pending_cancel, settled, risk_decision_id, release_id,
       configuration_version, raw_status, raw_response_hash, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(internal_order_id) DO UPDATE SET
       exchange_order_id = excluded.exchange_order_id,
       state = excluded.state,
       filled_base_quantity = excluded.filled_base_quantity,
       filled_quote_value = excluded.filled_quote_value,
       remaining_base_quantity = excluded.remaining_base_quantity,
       average_fill_price = excluded.average_fill_price,
       total_fees = excluded.total_fees,
       fee_asset = excluded.fee_asset,
       pending_cancel = excluded.pending_cancel,
       settled = excluded.settled,
       risk_decision_id = excluded.risk_decision_id,
       release_id = excluded.release_id,
       configuration_version = excluded.configuration_version,
       raw_status = excluded.raw_status,
       raw_response_hash = excluded.raw_response_hash,
       updated_at = excluded.updated_at`,
  ).bind(
    required(input.internalOrderId, 'internalOrderId'),
    required(input.exchangeAccountId, 'exchangeAccountId'),
    snapshot.exchangeOrderId,
    required(snapshot.clientOrderId ?? input.internalOrderId, 'clientOrderId'),
    snapshot.productId,
    snapshot.side,
    snapshot.orderType,
    input.state,
    snapshot.requestedBaseQuantity,
    snapshot.requestedQuoteNotional,
    snapshot.filledBaseQuantity,
    snapshot.filledQuoteValue,
    snapshot.remainingBaseQuantity,
    snapshot.averageFillPrice,
    snapshot.totalFees,
    input.feeAsset,
    bit(snapshot.pendingCancel),
    bit(snapshot.settled),
    input.riskDecisionId,
    input.releaseId,
    required(input.configurationVersion, 'configurationVersion'),
    snapshot.rawStatus,
    hash(input.rawResponseHash, 'rawResponseHash'),
    snapshot.createdAt,
    snapshot.updatedAt,
  )
}

function orderEventStatement(
  env: ProjectionEnv,
  event: OrderEvent,
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO live_order_events (
       event_id, internal_order_id, previous_state, next_state, source,
       source_event_id, actor_id, correlation_id, release_id,
       configuration_version, payload_hash, audit_event_hash, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.eventId,
    event.orderId,
    event.previousState,
    event.nextState,
    event.source,
    event.sourceEventId,
    event.actorId,
    event.correlationId,
    event.releaseId,
    event.configurationVersion,
    hash(event.payloadHash, 'payloadHash', true),
    hash(event.auditHash, 'auditHash', true),
    event.occurredAt,
  )
}

export async function projectOrderTransition(
  env: ProjectionEnv,
  input: OrderProjectionInput,
  event: OrderEvent,
): Promise<void> {
  if (event.orderId !== input.internalOrderId) {
    throw new TypeError('order event does not belong to the projected order')
  }
  if (event.nextState !== input.state) {
    throw new TypeError('order event nextState must equal projection state')
  }
  if (event.previousState !== null) {
    assertOrderTransition(event.previousState, event.nextState)
  }

  await env.DB.batch([
    orderStatement(env, input),
    orderEventStatement(env, event),
  ])
}

export async function insertFillProjection(
  env: ProjectionEnv,
  input: FillProjectionInput,
): Promise<void> {
  const quoteValue = multiplyDecimal(input.fill.price, input.fill.baseSize)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO live_fills (
       fill_id, trade_id, exchange_account_id, internal_order_id,
       exchange_order_id, product_id, side, price, base_size, quote_value,
       commission, commission_asset, trade_time, sequence_timestamp,
       raw_response_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.fill.fillId,
    input.fill.tradeId,
    required(input.exchangeAccountId, 'exchangeAccountId'),
    required(input.internalOrderId, 'internalOrderId'),
    input.fill.exchangeOrderId,
    input.fill.productId,
    input.fill.side,
    input.fill.price,
    input.fill.baseSize,
    quoteValue,
    input.fill.commission,
    input.fill.commissionAsset,
    input.fill.tradeTime,
    input.fill.sequenceTimestamp,
    hash(input.rawResponseHash, 'rawResponseHash', true),
  ).run()
}

export async function insertBalanceSnapshot(
  env: ProjectionEnv,
  input: {
    snapshotId: string
    exchangeAccountId: string
    balance: ExchangeAccountBalance
    source: 'exchange-rest' | 'exchange-websocket' | 'reconciliation'
    rawResponseHash: string
  },
): Promise<void> {
  const total = addDecimal(input.balance.available, input.balance.held)
  await env.DB.prepare(
    `INSERT INTO live_balance_snapshots (
       snapshot_id, exchange_account_id, external_asset_account_id, asset,
       available, held, total, active, ready, source, raw_response_hash,
       observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    required(input.snapshotId, 'snapshotId'),
    required(input.exchangeAccountId, 'exchangeAccountId'),
    input.balance.accountId,
    input.balance.asset,
    input.balance.available,
    input.balance.held,
    total,
    bit(input.balance.active),
    bit(input.balance.ready),
    input.source,
    hash(input.rawResponseHash, 'rawResponseHash', true),
    input.balance.observedAt,
  ).run()
}
