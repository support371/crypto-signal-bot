import type { ExchangeOrderSnapshot } from '../../exchange-contracts.ts'
import { CoinbaseReadOnlyNormalizer } from './normalizer.ts'

export interface CoinbaseUserStreamCursor {
  initialized: boolean
  lastSequence: number | null
  lastMessageAt: string | null
  lastHeartbeatAt: string | null
  recoveryRequired: boolean
  recoveryReason: string | null
}

export interface CoinbaseUserStreamDecision {
  action: 'APPLY' | 'IGNORE_DUPLICATE' | 'REST_SNAPSHOT_REQUIRED'
  cursor: CoinbaseUserStreamCursor
  orders: readonly ExchangeOrderSnapshot[]
  eventTypes: readonly string[]
  reason: string | null
}

interface CoinbaseMessage {
  channel: string
  sequence_num: number
  timestamp: string
  events?: unknown[]
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function timestamp(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized || !Number.isFinite(Date.parse(normalized))) {
    throw new TypeError(`${field} must be a valid ISO-8601 timestamp`)
  }
  return new Date(normalized).toISOString()
}

function parseMessage(input: unknown): CoinbaseMessage {
  const source = typeof input === 'string' ? JSON.parse(input) as unknown : input
  const message = record(source, 'message')
  const channel = String(message.channel ?? '').trim().toLowerCase()
  if (!channel) throw new TypeError('message.channel is required')
  const sequence = Number(message.sequence_num)
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TypeError('message.sequence_num must be a non-negative safe integer')
  }
  return {
    channel,
    sequence_num: sequence,
    timestamp: timestamp(message.timestamp, 'message.timestamp'),
    events: Array.isArray(message.events) ? message.events : [],
  }
}

function recovery(
  cursor: CoinbaseUserStreamCursor,
  reason: string,
  messageAt: string | null,
): CoinbaseUserStreamDecision {
  return {
    action: 'REST_SNAPSHOT_REQUIRED',
    cursor: {
      ...cursor,
      lastMessageAt: messageAt ?? cursor.lastMessageAt,
      recoveryRequired: true,
      recoveryReason: reason,
    },
    orders: [],
    eventTypes: [],
    reason,
  }
}

export function initialCoinbaseUserStreamCursor(): CoinbaseUserStreamCursor {
  return {
    initialized: false,
    lastSequence: null,
    lastMessageAt: null,
    lastHeartbeatAt: null,
    recoveryRequired: false,
    recoveryReason: null,
  }
}

export function applyCoinbaseUserStreamMessage(
  cursor: CoinbaseUserStreamCursor,
  input: unknown,
  normalizer = new CoinbaseReadOnlyNormalizer(),
): CoinbaseUserStreamDecision {
  let message: CoinbaseMessage
  try {
    message = parseMessage(input)
  } catch (error) {
    return recovery(cursor, `malformed_user_stream_message:${String(error)}`, null)
  }

  if (cursor.recoveryRequired) {
    return recovery(cursor, cursor.recoveryReason ?? 'recovery_already_required', message.timestamp)
  }

  if (message.channel === 'heartbeats') {
    return {
      action: 'APPLY',
      cursor: {
        ...cursor,
        lastMessageAt: message.timestamp,
        lastHeartbeatAt: message.timestamp,
      },
      orders: [],
      eventTypes: ['heartbeat'],
      reason: null,
    }
  }

  if (message.channel !== 'user') {
    return recovery(cursor, `unexpected_user_stream_channel:${message.channel}`, message.timestamp)
  }

  if (cursor.lastSequence !== null) {
    if (message.sequence_num === cursor.lastSequence) {
      return {
        action: 'IGNORE_DUPLICATE',
        cursor: {
          ...cursor,
          lastMessageAt: message.timestamp,
        },
        orders: [],
        eventTypes: [],
        reason: 'duplicate_sequence',
      }
    }
    if (message.sequence_num < cursor.lastSequence) {
      return recovery(cursor, 'out_of_order_sequence', message.timestamp)
    }
    if (message.sequence_num > cursor.lastSequence + 1) {
      return recovery(cursor, 'sequence_gap_detected', message.timestamp)
    }
  }

  const eventTypes: string[] = []
  const orders: ExchangeOrderSnapshot[] = []
  let sawSnapshot = false

  try {
    for (const rawEvent of message.events ?? []) {
      const event = record(rawEvent, 'event')
      const eventType = String(event.type ?? '').trim().toLowerCase()
      if (!eventType) throw new TypeError('event.type is required')
      eventTypes.push(eventType)
      if (eventType === 'snapshot') sawSnapshot = true
      const rawOrders = Array.isArray(event.orders) ? event.orders : []
      for (const rawOrder of rawOrders) {
        orders.push(normalizer.normalizeOrder(rawOrder))
      }
    }
  } catch (error) {
    return recovery(cursor, `malformed_user_stream_event:${String(error)}`, message.timestamp)
  }

  if (!cursor.initialized && !sawSnapshot) {
    return recovery(cursor, 'initial_user_snapshot_missing', message.timestamp)
  }

  return {
    action: 'APPLY',
    cursor: {
      initialized: true,
      lastSequence: message.sequence_num,
      lastMessageAt: message.timestamp,
      lastHeartbeatAt: cursor.lastHeartbeatAt,
      recoveryRequired: false,
      recoveryReason: null,
    },
    orders,
    eventTypes,
    reason: null,
  }
}

export function evaluateCoinbaseUserStreamFreshness(
  cursor: CoinbaseUserStreamCursor,
  now: Date,
  options: {
    maxMessageAgeMs?: number
    maxHeartbeatAgeMs?: number
  } = {},
): {
  healthy: boolean
  reasons: readonly string[]
} {
  const maxMessageAgeMs = options.maxMessageAgeMs ?? 30_000
  const maxHeartbeatAgeMs = options.maxHeartbeatAgeMs ?? 30_000
  const nowMs = now.getTime()
  const reasons: string[] = []

  if (!Number.isFinite(nowMs)) reasons.push('current_time_invalid')
  if (!cursor.initialized) reasons.push('user_stream_not_initialized')
  if (cursor.recoveryRequired) reasons.push(cursor.recoveryReason ?? 'user_stream_recovery_required')
  if (!cursor.lastMessageAt) {
    reasons.push('user_stream_message_missing')
  } else if (nowMs - Date.parse(cursor.lastMessageAt) > maxMessageAgeMs) {
    reasons.push('user_stream_message_stale')
  }
  if (!cursor.lastHeartbeatAt) {
    reasons.push('user_stream_heartbeat_missing')
  } else if (nowMs - Date.parse(cursor.lastHeartbeatAt) > maxHeartbeatAgeMs) {
    reasons.push('user_stream_heartbeat_stale')
  }

  return { healthy: reasons.length === 0, reasons }
}

export function recoverCoinbaseUserStreamCursor(
  snapshotSequence: number,
  recoveredAt: string,
): CoinbaseUserStreamCursor {
  if (!Number.isSafeInteger(snapshotSequence) || snapshotSequence < 0) {
    throw new TypeError('snapshotSequence must be a non-negative safe integer')
  }
  const normalizedTime = timestamp(recoveredAt, 'recoveredAt')
  return {
    initialized: true,
    lastSequence: snapshotSequence,
    lastMessageAt: normalizedTime,
    lastHeartbeatAt: null,
    recoveryRequired: false,
    recoveryReason: null,
  }
}
