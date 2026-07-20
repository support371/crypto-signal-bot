import { canonicalJson } from '../../canonical-json.ts'
import {
  addDecimal,
  asDecimalString,
  type DecimalString,
} from '../../decimal.ts'
import type {
  ExchangeFillSnapshot,
  ExchangeOrderSnapshot,
} from '../../exchange-contracts.ts'
import { BitgetReadOnlyAdapter } from './normalizer.ts'

export interface BitgetStreamFingerprint {
  identity: string
  fingerprint: string
}

export interface BitgetUserStreamCursor {
  connected: boolean
  initialized: boolean
  ordersSubscribed: boolean
  fillsSubscribed: boolean
  lastMessageAt: string | null
  lastPongAt: string | null
  lastServerTimestampMs: number | null
  lastRestSnapshotAt: string | null
  recentFingerprints: readonly BitgetStreamFingerprint[]
  recoveryRequired: boolean
  recoveryReason: string | null
}

export interface BitgetUserStreamDecision {
  action: 'APPLY' | 'IGNORE_DUPLICATE' | 'REST_SNAPSHOT_REQUIRED'
  cursor: BitgetUserStreamCursor
  orders: readonly ExchangeOrderSnapshot[]
  fills: readonly ExchangeFillSnapshot[]
  eventTypes: readonly string[]
  reason: string | null
}

export interface BitgetRecoverySnapshot {
  orders: readonly ExchangeOrderSnapshot[]
  fills: readonly ExchangeFillSnapshot[]
  snapshotAt: string
  serverTimestampMs: number
}

const MAX_RECENT_FINGERPRINTS = 256
const MAX_SERVER_CLOCK_AHEAD_MS = 30_000
const ZERO = asDecimalString('0')

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function iso(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  const parsed = Date.parse(normalized)
  if (!normalized || !Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function unixMilliseconds(value: unknown, field: string): number {
  const normalized = String(value ?? '').trim()
  if (!/^\d{13}$/.test(normalized)) throw new TypeError(`${field} must be Unix milliseconds`)
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${field} must be a non-negative safe Unix millisecond value`)
  }
  return parsed
}

function absoluteDecimal(value: unknown, field: string): DecimalString {
  const normalized = String(value ?? '').trim()
  return asDecimalString(normalized.startsWith('-') ? normalized.slice(1) : normalized || '0', field)
}

function adaptFeeDetail(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  let feeAsset: string | null = null
  let total = ZERO
  for (const [index, item] of value.entries()) {
    const detail = record(item, `feeDetail[${index}]`)
    const currentAsset = String(detail.feeCoin ?? '').trim().toUpperCase()
    if (!currentAsset) throw new TypeError(`feeDetail[${index}].feeCoin is required`)
    if (feeAsset !== null && currentAsset !== feeAsset) {
      throw new TypeError('multiple fee assets require REST recovery and explicit valuation')
    }
    feeAsset = currentAsset
    total = addDecimal(total, absoluteDecimal(detail.totalFee ?? detail.fee ?? '0', `feeDetail[${index}].fee`))
  }
  return feeAsset === null ? null : { totalFee: total, feeCoin: feeAsset }
}

function normalizedOrderInput(
  value: unknown,
  channelInstrument: string,
): Record<string, unknown> {
  const source = record(value, 'order')
  return {
    ...source,
    symbol: source.symbol ?? source.instId ?? channelInstrument,
    orderType: source.orderType ?? source.ordType,
    size: source.newSize ?? source.size,
    baseVolume: source.accBaseVolume ?? source.baseVolume ?? '0',
    quoteVolume: source.quoteVolume ?? source.notional,
    priceAvg: source.priceAvg ?? source.fillPrice,
    feeDetail: adaptFeeDetail(source.feeDetail),
  }
}

function normalizedFillInput(
  value: unknown,
  channelInstrument: string,
): Record<string, unknown> {
  const source = record(value, 'fill')
  return {
    ...source,
    symbol: source.symbol ?? source.instId ?? channelInstrument,
    price: source.price ?? source.priceAvg,
    size: source.size ?? source.baseVolume,
    feeDetail: adaptFeeDetail(source.feeDetail),
  }
}

function fingerprint(identity: string, value: unknown): BitgetStreamFingerprint {
  return Object.freeze({ identity, fingerprint: canonicalJson(value) })
}

function recovery(
  cursor: BitgetUserStreamCursor,
  reason: string,
  receivedAt: string,
): BitgetUserStreamDecision {
  return {
    action: 'REST_SNAPSHOT_REQUIRED',
    cursor: Object.freeze({
      ...cursor,
      lastMessageAt: receivedAt,
      recoveryRequired: true,
      recoveryReason: reason,
    }),
    orders: Object.freeze([]),
    fills: Object.freeze([]),
    eventTypes: Object.freeze([]),
    reason,
  }
}

function boundedFingerprints(
  previous: readonly BitgetStreamFingerprint[],
  additions: readonly BitgetStreamFingerprint[],
): readonly BitgetStreamFingerprint[] {
  const byIdentity = new Map(previous.map((item) => [item.identity, item]))
  for (const item of additions) byIdentity.set(item.identity, item)
  return Object.freeze(Array.from(byIdentity.values()).slice(-MAX_RECENT_FINGERPRINTS))
}

function classifyFingerprints(
  cursor: BitgetUserStreamCursor,
  incoming: readonly BitgetStreamFingerprint[],
): { duplicateCount: number; conflict: string | null } {
  const previous = new Map(cursor.recentFingerprints.map((item) => [item.identity, item.fingerprint]))
  let duplicateCount = 0
  for (const item of incoming) {
    const existing = previous.get(item.identity)
    if (existing === undefined) continue
    if (existing !== item.fingerprint) return { duplicateCount, conflict: item.identity }
    duplicateCount += 1
  }
  return { duplicateCount, conflict: null }
}

export function initialBitgetUserStreamCursor(): BitgetUserStreamCursor {
  return Object.freeze({
    connected: false,
    initialized: false,
    ordersSubscribed: false,
    fillsSubscribed: false,
    lastMessageAt: null,
    lastPongAt: null,
    lastServerTimestampMs: null,
    lastRestSnapshotAt: null,
    recentFingerprints: Object.freeze([]),
    recoveryRequired: true,
    recoveryReason: 'initial_rest_snapshot_required',
  })
}

export function markBitgetUserStreamConnected(
  cursor: BitgetUserStreamCursor,
  connectedAt: string,
): BitgetUserStreamCursor {
  const time = iso(connectedAt, 'connectedAt')
  return Object.freeze({
    ...cursor,
    connected: true,
    initialized: false,
    ordersSubscribed: false,
    fillsSubscribed: false,
    lastMessageAt: time,
    recoveryRequired: true,
    recoveryReason: 'rest_snapshot_required_after_connect',
  })
}

export function markBitgetUserStreamDisconnected(
  cursor: BitgetUserStreamCursor,
  disconnectedAt: string,
): BitgetUserStreamCursor {
  return Object.freeze({
    ...cursor,
    connected: false,
    initialized: false,
    lastMessageAt: iso(disconnectedAt, 'disconnectedAt'),
    recoveryRequired: true,
    recoveryReason: 'websocket_disconnected',
  })
}

export function recoverBitgetUserStreamCursor(
  cursor: BitgetUserStreamCursor,
  snapshot: BitgetRecoverySnapshot,
): BitgetUserStreamCursor {
  const snapshotAt = iso(snapshot.snapshotAt, 'snapshotAt')
  if (!Number.isSafeInteger(snapshot.serverTimestampMs) || snapshot.serverTimestampMs < 0) {
    throw new TypeError('serverTimestampMs must be a non-negative safe integer')
  }
  const fingerprints = [
    ...snapshot.orders.map((order) => fingerprint(
      `order:${order.exchangeOrderId ?? order.clientOrderId ?? 'missing'}:${order.updatedAt}`,
      order,
    )),
    ...snapshot.fills.map((fill) => fingerprint(`fill:${fill.fillId}`, fill)),
  ]
  return Object.freeze({
    ...cursor,
    connected: true,
    initialized: true,
    lastMessageAt: snapshotAt,
    lastServerTimestampMs: snapshot.serverTimestampMs,
    lastRestSnapshotAt: snapshotAt,
    recentFingerprints: boundedFingerprints(cursor.recentFingerprints, fingerprints),
    recoveryRequired: false,
    recoveryReason: null,
  })
}

export function applyBitgetUserStreamMessage(
  cursor: BitgetUserStreamCursor,
  input: unknown,
  receivedAtInput: string,
  normalizer = new BitgetReadOnlyAdapter(),
): BitgetUserStreamDecision {
  const receivedAt = iso(receivedAtInput, 'receivedAt')
  const receivedAtMs = Date.parse(receivedAt)

  if (input === 'pong') {
    const pongCursor = Object.freeze({
      ...cursor,
      lastMessageAt: receivedAt,
      lastPongAt: receivedAt,
    })
    return cursor.recoveryRequired
      ? recovery(pongCursor, cursor.recoveryReason ?? 'rest_snapshot_required', receivedAt)
      : {
          action: 'APPLY',
          cursor: pongCursor,
          orders: Object.freeze([]),
          fills: Object.freeze([]),
          eventTypes: Object.freeze(['pong']),
          reason: null,
        }
  }

  let message: Record<string, unknown>
  try {
    const parsed = typeof input === 'string' ? JSON.parse(input) as unknown : input
    message = record(parsed, 'message')
  } catch (error) {
    return recovery(cursor, `malformed_bitget_stream_message:${String(error)}`, receivedAt)
  }

  const event = String(message.event ?? '').trim().toLowerCase()
  if (event) {
    if (event === 'error' || (message.code !== undefined && String(message.code) !== '0')) {
      return recovery(cursor, `bitget_stream_event_error:${String(message.code ?? event)}`, receivedAt)
    }
    const arg = message.arg && typeof message.arg === 'object' && !Array.isArray(message.arg)
      ? message.arg as Record<string, unknown>
      : {}
    const channel = String(arg.channel ?? '').trim().toLowerCase()
    const next = Object.freeze({
      ...cursor,
      connected: true,
      ordersSubscribed: cursor.ordersSubscribed || (event === 'subscribe' && channel === 'orders'),
      fillsSubscribed: cursor.fillsSubscribed || (event === 'subscribe' && channel === 'fill'),
      lastMessageAt: receivedAt,
    })
    return cursor.recoveryRequired
      ? recovery(next, cursor.recoveryReason ?? 'rest_snapshot_required', receivedAt)
      : {
          action: 'APPLY',
          cursor: next,
          orders: Object.freeze([]),
          fills: Object.freeze([]),
          eventTypes: Object.freeze([event]),
          reason: null,
        }
  }

  if (cursor.recoveryRequired || !cursor.initialized) {
    return recovery(cursor, cursor.recoveryReason ?? 'rest_snapshot_required', receivedAt)
  }
  if (!cursor.connected) return recovery(cursor, 'websocket_not_connected', receivedAt)

  try {
    const arg = record(message.arg, 'message.arg')
    const instType = String(arg.instType ?? '').trim().toUpperCase()
    const channel = String(arg.channel ?? '').trim().toLowerCase()
    const instrument = String(arg.instId ?? 'default').trim().toUpperCase()
    if (instType !== 'SPOT') return recovery(cursor, `unexpected_instrument_type:${instType}`, receivedAt)
    if (!['orders', 'fill'].includes(channel)) {
      return recovery(cursor, `unexpected_private_channel:${channel}`, receivedAt)
    }
    if (channel === 'orders' && !cursor.ordersSubscribed) {
      return recovery(cursor, 'orders_channel_not_subscribed', receivedAt)
    }
    if (channel === 'fill' && !cursor.fillsSubscribed) {
      return recovery(cursor, 'fill_channel_not_subscribed', receivedAt)
    }

    const serverTimestampMs = unixMilliseconds(message.ts, 'message.ts')
    if (serverTimestampMs > receivedAtMs + MAX_SERVER_CLOCK_AHEAD_MS) {
      return recovery(cursor, 'server_timestamp_too_far_ahead', receivedAt)
    }
    if (
      cursor.lastServerTimestampMs !== null
      && serverTimestampMs < cursor.lastServerTimestampMs
    ) {
      return recovery(cursor, 'server_timestamp_regression', receivedAt)
    }
    if (cursor.lastMessageAt && receivedAtMs < Date.parse(cursor.lastMessageAt)) {
      return recovery(cursor, 'local_receive_time_regression', receivedAt)
    }

    const rawData = Array.isArray(message.data) ? message.data : []
    const orders: ExchangeOrderSnapshot[] = []
    const fills: ExchangeFillSnapshot[] = []
    const incomingFingerprints: BitgetStreamFingerprint[] = []

    if (channel === 'orders') {
      for (const raw of rawData) {
        const order = normalizer.normalizeOrder(normalizedOrderInput(raw, instrument))
        const identity = `order:${order.exchangeOrderId ?? order.clientOrderId ?? 'missing'}:${order.updatedAt}`
        if (identity.includes(':missing:')) {
          return recovery(cursor, 'order_identifier_missing', receivedAt)
        }
        orders.push(order)
        incomingFingerprints.push(fingerprint(identity, order))
      }
    } else {
      for (const raw of rawData) {
        const fill = normalizer.normalizeFill(normalizedFillInput(raw, instrument))
        fills.push(fill)
        incomingFingerprints.push(fingerprint(`fill:${fill.fillId}`, fill))
      }
    }

    const classification = classifyFingerprints(cursor, incomingFingerprints)
    if (classification.conflict) {
      return recovery(cursor, `conflicting_stream_identity:${classification.conflict}`, receivedAt)
    }

    const nextCursor = Object.freeze({
      ...cursor,
      lastMessageAt: receivedAt,
      lastServerTimestampMs: serverTimestampMs,
      recentFingerprints: boundedFingerprints(cursor.recentFingerprints, incomingFingerprints),
      recoveryRequired: false,
      recoveryReason: null,
    })
    if (incomingFingerprints.length > 0 && classification.duplicateCount === incomingFingerprints.length) {
      return {
        action: 'IGNORE_DUPLICATE',
        cursor: nextCursor,
        orders: Object.freeze([]),
        fills: Object.freeze([]),
        eventTypes: Object.freeze([]),
        reason: 'duplicate_stream_event',
      }
    }

    return {
      action: 'APPLY',
      cursor: nextCursor,
      orders: Object.freeze(orders),
      fills: Object.freeze(fills),
      eventTypes: Object.freeze([`${channel}:${String(message.action ?? 'snapshot').trim().toLowerCase()}`]),
      reason: null,
    }
  } catch (error) {
    return recovery(cursor, `malformed_bitget_stream_event:${String(error)}`, receivedAt)
  }
}

export function evaluateBitgetUserStreamFreshness(
  cursor: BitgetUserStreamCursor,
  now: Date,
  options: {
    maxMessageAgeMs?: number
    maxPongAgeMs?: number
  } = {},
): { healthy: boolean; reasons: readonly string[] } {
  const maxMessageAgeMs = options.maxMessageAgeMs ?? 30_000
  const maxPongAgeMs = options.maxPongAgeMs ?? 45_000
  const nowMs = now.getTime()
  const reasons: string[] = []
  if (!Number.isFinite(nowMs)) reasons.push('current_time_invalid')
  if (!cursor.connected) reasons.push('bitget_stream_disconnected')
  if (!cursor.initialized) reasons.push('bitget_stream_not_initialized')
  if (!cursor.ordersSubscribed) reasons.push('bitget_orders_not_subscribed')
  if (!cursor.fillsSubscribed) reasons.push('bitget_fills_not_subscribed')
  if (cursor.recoveryRequired) reasons.push(cursor.recoveryReason ?? 'bitget_stream_recovery_required')
  if (!cursor.lastMessageAt) reasons.push('bitget_stream_message_missing')
  else if (nowMs - Date.parse(cursor.lastMessageAt) > maxMessageAgeMs) {
    reasons.push('bitget_stream_message_stale')
  }
  if (!cursor.lastPongAt) reasons.push('bitget_stream_pong_missing')
  else if (nowMs - Date.parse(cursor.lastPongAt) > maxPongAgeMs) {
    reasons.push('bitget_stream_pong_stale')
  }
  return { healthy: reasons.length === 0, reasons: Object.freeze(reasons) }
}
