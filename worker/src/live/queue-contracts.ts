import { canonicalHash, canonicalJson } from './canonical-json.ts'

export type LiveQueueMessageType =
  | 'RECONCILE_ACCOUNT'
  | 'PROCESS_FILL'
  | 'REFRESH_BALANCES'
  | 'MONITOR_TRANSFERS'
  | 'EXPORT_AUDIT'
  | 'NOTIFY_ALERT'

export type LiveQueueMessageStatus =
  | 'RECEIVED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTER'

export interface LiveQueueEnvelope<TPayload = unknown> {
  eventId: string
  messageType: LiveQueueMessageType
  exchangeAccountId: string | null
  correlationId: string
  payload: TPayload
  receivedAt: string
  availableAt: string
}

export interface QueueEnv {
  DB: D1Database
}

export interface QueueRegistrationResult {
  state: 'REGISTERED' | 'DUPLICATE' | 'CONFLICT'
  status: LiveQueueMessageStatus
  attemptCount: number
}

interface QueueRow {
  payload_hash: string
  status: LiveQueueMessageStatus
  attempt_count: number
}

const MESSAGE_TYPES = new Set<LiveQueueMessageType>([
  'RECONCILE_ACCOUNT',
  'PROCESS_FILL',
  'REFRESH_BALANCES',
  'MONITOR_TRANSFERS',
  'EXPORT_AUDIT',
  'NOTIFY_ALERT',
])

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(value).toISOString()
}

function hash(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

export function normalizeQueueEnvelope<TPayload>(
  input: LiveQueueEnvelope<TPayload>,
): LiveQueueEnvelope<TPayload> {
  if (!MESSAGE_TYPES.has(input.messageType)) {
    throw new TypeError(`unsupported messageType: ${String(input.messageType)}`)
  }
  return {
    eventId: required(input.eventId, 'eventId'),
    messageType: input.messageType,
    exchangeAccountId: input.exchangeAccountId?.trim() || null,
    correlationId: required(input.correlationId, 'correlationId'),
    payload: input.payload,
    receivedAt: timestamp(input.receivedAt, 'receivedAt'),
    availableAt: timestamp(input.availableAt, 'availableAt'),
  }
}

export async function queueEnvelopeHash(
  input: LiveQueueEnvelope,
): Promise<string> {
  const normalized = normalizeQueueEnvelope(input)
  return canonicalHash({
    eventId: normalized.eventId,
    messageType: normalized.messageType,
    exchangeAccountId: normalized.exchangeAccountId,
    correlationId: normalized.correlationId,
    payload: normalized.payload,
    receivedAt: normalized.receivedAt,
    availableAt: normalized.availableAt,
  })
}

export async function registerQueueDelivery(
  env: QueueEnv,
  input: LiveQueueEnvelope,
): Promise<QueueRegistrationResult> {
  const normalized = normalizeQueueEnvelope(input)
  const payloadJson = canonicalJson(normalized.payload)
  const payloadHash = await queueEnvelopeHash(normalized)
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO live_queue_messages (
       event_id, message_type, exchange_account_id, correlation_id,
       payload_json, payload_hash, status, received_at, available_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)`,
  ).bind(
    normalized.eventId,
    normalized.messageType,
    normalized.exchangeAccountId,
    normalized.correlationId,
    payloadJson,
    payloadHash,
    normalized.receivedAt,
    normalized.availableAt,
  ).run()

  if ((inserted.meta?.changes ?? 0) === 1) {
    return { state: 'REGISTERED', status: 'RECEIVED', attemptCount: 0 }
  }

  const existing = await env.DB.prepare(
    `SELECT payload_hash, status, attempt_count
       FROM live_queue_messages
      WHERE event_id = ?
      LIMIT 1`,
  ).bind(normalized.eventId).first<QueueRow>()
  if (!existing) throw new Error('queue delivery collision without readable record')
  if (existing.payload_hash !== payloadHash) {
    return {
      state: 'CONFLICT',
      status: existing.status,
      attemptCount: Number(existing.attempt_count),
    }
  }
  return {
    state: 'DUPLICATE',
    status: existing.status,
    attemptCount: Number(existing.attempt_count),
  }
}

export async function claimQueueDelivery(
  env: QueueEnv,
  eventId: string,
  startedAt: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE live_queue_messages
        SET status = 'PROCESSING',
            attempt_count = attempt_count + 1,
            processing_started_at = ?,
            last_error_code = NULL,
            last_error_detail = NULL,
            updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ?
        AND status IN ('RECEIVED', 'FAILED')
        AND available_at <= ?`,
  ).bind(
    timestamp(startedAt, 'startedAt'),
    required(eventId, 'eventId'),
    timestamp(startedAt, 'startedAt'),
  ).run()
  return (result.meta?.changes ?? 0) === 1
}

export async function completeQueueDelivery(
  env: QueueEnv,
  eventId: string,
  completedAt: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE live_queue_messages
        SET status = 'COMPLETED', completed_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ? AND status = 'PROCESSING'`,
  ).bind(
    timestamp(completedAt, 'completedAt'),
    required(eventId, 'eventId'),
  ).run()
  return (result.meta?.changes ?? 0) === 1
}

export async function failQueueDelivery(
  env: QueueEnv,
  input: {
    eventId: string
    errorCode: string
    errorDetail?: string | null
    retryAt: string
  },
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE live_queue_messages
        SET status = 'FAILED', last_error_code = ?, last_error_detail = ?,
            available_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ? AND status = 'PROCESSING'`,
  ).bind(
    required(input.errorCode, 'errorCode').slice(0, 128),
    input.errorDetail?.trim().slice(0, 2048) || null,
    timestamp(input.retryAt, 'retryAt'),
    required(input.eventId, 'eventId'),
  ).run()
  return (result.meta?.changes ?? 0) === 1
}

export async function deadLetterQueueDelivery(
  env: QueueEnv,
  input: {
    deadLetterId: string
    eventId: string
    errorCode: string
    errorDetail?: string | null
    auditEventHash: string
    createdAt: string
  },
): Promise<void> {
  const message = await env.DB.prepare(
    `SELECT event_id, message_type, exchange_account_id, correlation_id,
            payload_hash, attempt_count, status
       FROM live_queue_messages
      WHERE event_id = ?
      LIMIT 1`,
  ).bind(input.eventId).first<{
    event_id: string
    message_type: LiveQueueMessageType
    exchange_account_id: string | null
    correlation_id: string
    payload_hash: string
    attempt_count: number
    status: LiveQueueMessageStatus
  }>()
  if (!message || !['PROCESSING', 'FAILED'].includes(message.status)) {
    throw new Error('queue message is not eligible for dead lettering')
  }
  if (Number(message.attempt_count) < 1) {
    throw new Error('queue message has no recorded processing attempt')
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE live_queue_messages
          SET status = 'DEAD_LETTER', last_error_code = ?, last_error_detail = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE event_id = ? AND status IN ('PROCESSING', 'FAILED')`,
    ).bind(
      required(input.errorCode, 'errorCode').slice(0, 128),
      input.errorDetail?.trim().slice(0, 2048) || null,
      required(input.eventId, 'eventId'),
    ),
    env.DB.prepare(
      `INSERT INTO live_dead_letter_records (
         dead_letter_id, event_id, message_type, exchange_account_id,
         correlation_id, payload_hash, final_attempt_count, error_code,
         error_detail, audit_event_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      required(input.deadLetterId, 'deadLetterId'),
      message.event_id,
      message.message_type,
      message.exchange_account_id,
      message.correlation_id,
      hash(message.payload_hash, 'payloadHash'),
      Number(message.attempt_count),
      required(input.errorCode, 'errorCode').slice(0, 128),
      input.errorDetail?.trim().slice(0, 2048) || null,
      hash(input.auditEventHash, 'auditEventHash'),
      timestamp(input.createdAt, 'createdAt'),
    ),
  ])
}
