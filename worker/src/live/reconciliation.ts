import {
  asDecimalString,
  compareDecimal,
  isPositiveDecimal,
  subtractNonNegativeDecimal,
  type DecimalString,
} from './decimal.ts'

export type ReconciledOrderState =
  | 'SUBMITTED'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'RECOVERY_REQUIRED'

export type ReconciliationAction =
  | 'WAIT'
  | 'FINALIZE'
  | 'FINALIZE_PARTIAL'
  | 'HALT_FOR_REVIEW'

export interface RawOrderObservation {
  id?: unknown
  orderId?: unknown
  status?: unknown
  amount?: unknown
  filled?: unknown
  remaining?: unknown
  average?: unknown
  fillPrice?: unknown
  price?: unknown
  observedAt?: unknown
}

export interface ReconciliationDecision {
  exchangeOrderId: string | null
  state: ReconciledOrderState
  action: ReconciliationAction
  requestedQuantity: DecimalString
  filledQuantity: DecimalString
  remainingQuantity: DecimalString
  averageFillPrice: DecimalString | null
  terminal: boolean
  requiresReview: boolean
  rawStatus: string
  reason: string | null
  observedAt: string | null
}

const ACTIVE_STATUSES = new Set([
  'new',
  'open',
  'pending',
  'submitted',
  'partially_filled',
  'partiallyfilled',
  'partial',
])
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled'])
const REJECTED_STATUSES = new Set(['rejected', 'failed'])
const EXPIRED_STATUSES = new Set(['expired'])
const FILLED_STATUSES = new Set(['filled', 'closed', 'done'])

function optionalDecimal(value: unknown, field: string): DecimalString | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  try {
    return asDecimalString(value, field)
  } catch {
    return null
  }
}

function normalizedId(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function recovery(
  input: {
    exchangeOrderId: string | null
    requestedQuantity: DecimalString
    filledQuantity?: DecimalString
    remainingQuantity?: DecimalString
    averageFillPrice?: DecimalString | null
    rawStatus: string
    observedAt?: string | null
    reason: string
  },
): ReconciliationDecision {
  return {
    exchangeOrderId: input.exchangeOrderId,
    state: 'RECOVERY_REQUIRED',
    action: 'HALT_FOR_REVIEW',
    requestedQuantity: input.requestedQuantity,
    filledQuantity: input.filledQuantity ?? asDecimalString('0'),
    remainingQuantity: input.remainingQuantity ?? input.requestedQuantity,
    averageFillPrice: input.averageFillPrice ?? null,
    terminal: false,
    requiresReview: true,
    rawStatus: input.rawStatus,
    reason: input.reason,
    observedAt: input.observedAt ?? null,
  }
}

function observationTimestamp(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized || !Number.isFinite(Date.parse(normalized))) return null
  return new Date(normalized).toISOString()
}

export function reconcileOrderObservation(
  observation: RawOrderObservation,
  requestedQuantityInput: DecimalString,
  options: {
    now?: Date
    staleAfterMs?: number
  } = {},
): ReconciliationDecision {
  const requestedQuantity = asDecimalString(requestedQuantityInput, 'requestedQuantity')
  const exchangeOrderId = normalizedId(observation.id ?? observation.orderId)
  const rawStatus = String(observation.status ?? '').trim().toLowerCase()
  const filledQuantity = optionalDecimal(observation.filled, 'filled')
  const reportedRemaining = optionalDecimal(observation.remaining, 'remaining')
  const averageFillPrice = optionalDecimal(
    observation.average ?? observation.fillPrice ?? observation.price,
    'averageFillPrice',
  )
  const observedAt = observationTimestamp(observation.observedAt)
  const now = options.now ?? new Date()
  const staleAfterMs = options.staleAfterMs ?? 300_000

  if (!exchangeOrderId) {
    return recovery({
      exchangeOrderId: null,
      requestedQuantity,
      rawStatus,
      observedAt,
      reason: 'exchange_order_id_missing',
    })
  }
  if (!isPositiveDecimal(requestedQuantity)) {
    return recovery({
      exchangeOrderId,
      requestedQuantity,
      rawStatus,
      observedAt,
      reason: 'requested_quantity_not_positive',
    })
  }
  if (filledQuantity === null) {
    return recovery({
      exchangeOrderId,
      requestedQuantity,
      rawStatus,
      observedAt,
      reason: 'filled_quantity_invalid_or_missing',
    })
  }
  if (compareDecimal(filledQuantity, requestedQuantity) > 0) {
    return recovery({
      exchangeOrderId,
      requestedQuantity,
      filledQuantity,
      rawStatus,
      observedAt,
      reason: 'filled_quantity_exceeds_requested',
    })
  }

  const expectedRemaining = subtractNonNegativeDecimal(
    requestedQuantity,
    filledQuantity,
    'remainingQuantity',
  )
  if (
    reportedRemaining !== null
    && compareDecimal(reportedRemaining, expectedRemaining) !== 0
  ) {
    return recovery({
      exchangeOrderId,
      requestedQuantity,
      filledQuantity,
      remainingQuantity: reportedRemaining,
      averageFillPrice,
      rawStatus,
      observedAt,
      reason: 'remaining_quantity_inconsistent',
    })
  }

  if (compareDecimal(filledQuantity, requestedQuantity) === 0) {
    return {
      exchangeOrderId,
      state: 'FILLED',
      action: 'FINALIZE',
      requestedQuantity,
      filledQuantity,
      remainingQuantity: asDecimalString('0'),
      averageFillPrice,
      terminal: true,
      requiresReview: false,
      rawStatus,
      reason: null,
      observedAt,
    }
  }

  const hasPartialFill = isPositiveDecimal(filledQuantity)
  const isTerminalRaw = CANCELLED_STATUSES.has(rawStatus)
    || REJECTED_STATUSES.has(rawStatus)
    || EXPIRED_STATUSES.has(rawStatus)
    || FILLED_STATUSES.has(rawStatus)

  if (hasPartialFill && isTerminalRaw) {
    return {
      exchangeOrderId,
      state: 'PARTIALLY_FILLED',
      action: 'FINALIZE_PARTIAL',
      requestedQuantity,
      filledQuantity,
      remainingQuantity: expectedRemaining,
      averageFillPrice,
      terminal: true,
      requiresReview: false,
      rawStatus,
      reason: 'terminal_partial_fill',
      observedAt,
    }
  }

  const stale = Boolean(
    observedAt
      && Number.isFinite(now.getTime())
      && staleAfterMs >= 0
      && now.getTime() - Date.parse(observedAt) >= staleAfterMs,
  )

  if (hasPartialFill && ACTIVE_STATUSES.has(rawStatus)) {
    if (stale) {
      return recovery({
        exchangeOrderId,
        requestedQuantity,
        filledQuantity,
        remainingQuantity: expectedRemaining,
        averageFillPrice,
        rawStatus,
        observedAt,
        reason: 'stale_partially_filled_order',
      })
    }
    return {
      exchangeOrderId,
      state: 'PARTIALLY_FILLED',
      action: 'WAIT',
      requestedQuantity,
      filledQuantity,
      remainingQuantity: expectedRemaining,
      averageFillPrice,
      terminal: false,
      requiresReview: false,
      rawStatus,
      reason: null,
      observedAt,
    }
  }

  if (CANCELLED_STATUSES.has(rawStatus)) {
    return {
      exchangeOrderId,
      state: 'CANCELLED',
      action: 'FINALIZE',
      requestedQuantity,
      filledQuantity,
      remainingQuantity: requestedQuantity,
      averageFillPrice,
      terminal: true,
      requiresReview: false,
      rawStatus,
      reason: null,
      observedAt,
    }
  }
  if (REJECTED_STATUSES.has(rawStatus)) {
    return {
      exchangeOrderId,
      state: 'REJECTED',
      action: 'FINALIZE',
      requestedQuantity,
      filledQuantity,
      remainingQuantity: requestedQuantity,
      averageFillPrice,
      terminal: true,
      requiresReview: false,
      rawStatus,
      reason: null,
      observedAt,
    }
  }
  if (EXPIRED_STATUSES.has(rawStatus)) {
    return {
      exchangeOrderId,
      state: 'EXPIRED',
      action: 'FINALIZE',
      requestedQuantity,
      filledQuantity,
      remainingQuantity: requestedQuantity,
      averageFillPrice,
      terminal: true,
      requiresReview: false,
      rawStatus,
      reason: null,
      observedAt,
    }
  }
  if (FILLED_STATUSES.has(rawStatus)) {
    return recovery({
      exchangeOrderId,
      requestedQuantity,
      filledQuantity,
      remainingQuantity: expectedRemaining,
      averageFillPrice,
      rawStatus,
      observedAt,
      reason: 'terminal_filled_status_without_full_quantity',
    })
  }
  if (ACTIVE_STATUSES.has(rawStatus)) {
    if (stale) {
      return recovery({
        exchangeOrderId,
        requestedQuantity,
        filledQuantity,
        remainingQuantity: expectedRemaining,
        averageFillPrice,
        rawStatus,
        observedAt,
        reason: 'stale_open_order',
      })
    }
    return {
      exchangeOrderId,
      state: rawStatus === 'submitted' || rawStatus === 'pending' ? 'SUBMITTED' : 'OPEN',
      action: 'WAIT',
      requestedQuantity,
      filledQuantity,
      remainingQuantity: expectedRemaining,
      averageFillPrice,
      terminal: false,
      requiresReview: false,
      rawStatus,
      reason: null,
      observedAt,
    }
  }

  return recovery({
    exchangeOrderId,
    requestedQuantity,
    filledQuantity,
    remainingQuantity: expectedRemaining,
    averageFillPrice,
    rawStatus,
    observedAt,
    reason: 'unsupported_exchange_status',
  })
}
