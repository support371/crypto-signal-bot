import type { OrderState } from './domain.ts'

export interface RecoveryScanEnv {
  DB: D1Database
}

export interface LiveRecoveryCandidate {
  internalOrderId: string
  exchangeAccountId: string
  exchangeOrderId: string | null
  clientOrderId: string | null
  productId: string
  state: OrderState
  updatedAt: string
  recoveryReason: 'EXPLICIT_RECOVERY_REQUIRED' | 'STALE_EXCHANGE_ACTIVE_ORDER'
}

interface LiveRecoveryCandidateRow {
  internal_order_id: string
  exchange_account_id: string
  exchange_order_id: string | null
  client_order_id: string | null
  product_id: string
  state: OrderState
  updated_at: string
}

const EXCHANGE_ACTIVE_STATES: readonly OrderState[] = [
  'SUBMITTING',
  'SUBMITTED',
  'OPEN',
  'PARTIALLY_FILLED',
  'CANCEL_REQUESTED',
  'CANCEL_PENDING',
]

function validIso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be ISO-8601`)
  }
  return new Date(value).toISOString()
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return 100
  if (!Number.isInteger(value) || value < 1 || value > 500) {
    throw new TypeError('limit must be an integer between 1 and 500')
  }
  return value
}

/**
 * Read-only restart/reconciliation scanner.
 *
 * It never mutates an order and never contacts an exchange. It identifies
 * records that require a subsequent provider-specific read-only lookup:
 *
 * - every explicit RECOVERY_REQUIRED order; and
 * - exchange-active orders whose projection has not advanced since the
 *   supplied cutoff.
 *
 * Provider submission must never be retried from this result alone.
 */
export async function scanLiveOrdersForRecovery(
  env: RecoveryScanEnv,
  input: {
    staleBefore: string
    limit?: number
  },
): Promise<readonly LiveRecoveryCandidate[]> {
  const staleBefore = validIso(input.staleBefore, 'staleBefore')
  const limit = boundedLimit(input.limit)
  const placeholders = EXCHANGE_ACTIVE_STATES.map(() => '?').join(', ')

  const result = await env.DB.prepare(
    `SELECT internal_order_id, exchange_account_id, exchange_order_id,
            client_order_id, product_id, state, updated_at
       FROM live_orders
      WHERE state = 'RECOVERY_REQUIRED'
         OR (state IN (${placeholders}) AND updated_at <= ?)
      ORDER BY updated_at ASC, internal_order_id ASC
      LIMIT ?`,
  ).bind(
    ...EXCHANGE_ACTIVE_STATES,
    staleBefore,
    limit,
  ).all<LiveRecoveryCandidateRow>()

  return Object.freeze((result.results ?? []).map((row) => Object.freeze({
    internalOrderId: row.internal_order_id,
    exchangeAccountId: row.exchange_account_id,
    exchangeOrderId: row.exchange_order_id,
    clientOrderId: row.client_order_id,
    productId: row.product_id,
    state: row.state,
    updatedAt: row.updated_at,
    recoveryReason: row.state === 'RECOVERY_REQUIRED'
      ? 'EXPLICIT_RECOVERY_REQUIRED' as const
      : 'STALE_EXCHANGE_ACTIVE_ORDER' as const,
  })))
}
