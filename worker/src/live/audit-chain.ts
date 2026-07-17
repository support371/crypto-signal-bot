import { canonicalHash, canonicalJson } from './canonical-json.ts'

export interface AuditEnv {
  DB: D1Database
}

export interface AuditEventInput {
  eventId: string
  exchangeAccountId: string
  actorId: string | null
  actorRole: string | null
  action: string
  resourceType: string
  resourceId: string
  correlationId: string
  idempotencyKey: string | null
  configurationVersion: string
  releaseId: string | null
  outcome: string
  before: unknown
  after: unknown
  occurredAt: string
}

export interface AuditEventRecord extends AuditEventInput {
  previousEventHash: string
  eventHash: string
  beforeJson: string
  afterJson: string
}

interface LatestAuditRow {
  event_hash: string
}

export class AuditChainConflict extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditChainConflict'
  }
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function validHash(value: string): boolean {
  return value === 'GENESIS' || /^[a-f0-9]{64}$/.test(value)
}

export async function buildAuditEvent(
  input: AuditEventInput,
  previousEventHash = 'GENESIS',
): Promise<AuditEventRecord> {
  required(input.eventId, 'eventId')
  required(input.exchangeAccountId, 'exchangeAccountId')
  required(input.action, 'action')
  required(input.resourceType, 'resourceType')
  required(input.resourceId, 'resourceId')
  required(input.correlationId, 'correlationId')
  required(input.configurationVersion, 'configurationVersion')
  required(input.outcome, 'outcome')
  if (!Number.isFinite(Date.parse(input.occurredAt))) {
    throw new TypeError('occurredAt must be a valid ISO-8601 timestamp')
  }
  if (!validHash(previousEventHash)) {
    throw new TypeError('previousEventHash must be GENESIS or a lowercase SHA-256 hash')
  }

  const normalized: AuditEventInput = {
    ...input,
    eventId: input.eventId.trim(),
    exchangeAccountId: input.exchangeAccountId.trim(),
    actorId: input.actorId?.trim() || null,
    actorRole: input.actorRole?.trim() || null,
    action: input.action.trim(),
    resourceType: input.resourceType.trim(),
    resourceId: input.resourceId.trim(),
    correlationId: input.correlationId.trim(),
    idempotencyKey: input.idempotencyKey?.trim() || null,
    configurationVersion: input.configurationVersion.trim(),
    releaseId: input.releaseId?.trim() || null,
    outcome: input.outcome.trim(),
    occurredAt: new Date(input.occurredAt).toISOString(),
  }
  const beforeJson = canonicalJson(normalized.before)
  const afterJson = canonicalJson(normalized.after)
  const hashPayload = {
    eventId: normalized.eventId,
    exchangeAccountId: normalized.exchangeAccountId,
    actorId: normalized.actorId,
    actorRole: normalized.actorRole,
    action: normalized.action,
    resourceType: normalized.resourceType,
    resourceId: normalized.resourceId,
    correlationId: normalized.correlationId,
    idempotencyKey: normalized.idempotencyKey,
    configurationVersion: normalized.configurationVersion,
    releaseId: normalized.releaseId,
    outcome: normalized.outcome,
    beforeJson,
    afterJson,
    previousEventHash,
    occurredAt: normalized.occurredAt,
  }

  return {
    ...normalized,
    beforeJson,
    afterJson,
    previousEventHash,
    eventHash: await canonicalHash(hashPayload),
  }
}

export async function appendAuditEvent(
  env: AuditEnv,
  input: AuditEventInput,
): Promise<AuditEventRecord> {
  const latest = await env.DB.prepare(
    `SELECT event_hash
       FROM immutable_audit_events
      WHERE exchange_account_id = ?
      ORDER BY sequence_id DESC
      LIMIT 1`,
  ).bind(input.exchangeAccountId).first<LatestAuditRow>()
  const previousEventHash = latest?.event_hash ?? 'GENESIS'
  const event = await buildAuditEvent(input, previousEventHash)

  try {
    await env.DB.prepare(
      `INSERT INTO immutable_audit_events (
         event_id, exchange_account_id, actor_id, actor_role, action,
         resource_type, resource_id, correlation_id, idempotency_key,
         configuration_version, release_id, outcome, before_json,
         after_json, previous_event_hash, event_hash, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.eventId,
      event.exchangeAccountId,
      event.actorId,
      event.actorRole,
      event.action,
      event.resourceType,
      event.resourceId,
      event.correlationId,
      event.idempotencyKey,
      event.configurationVersion,
      event.releaseId,
      event.outcome,
      event.beforeJson,
      event.afterJson,
      event.previousEventHash,
      event.eventHash,
      event.occurredAt,
    ).run()
  } catch (error) {
    throw new AuditChainConflict(
      `Audit append failed; the account chain may have advanced concurrently: ${String(error)}`,
    )
  }

  return event
}

export async function verifyAuditChain(
  events: readonly AuditEventRecord[],
): Promise<{ valid: boolean; invalidEventId: string | null }> {
  let previous = 'GENESIS'
  for (const event of events) {
    if (event.previousEventHash !== previous) {
      return { valid: false, invalidEventId: event.eventId }
    }
    const rebuilt = await buildAuditEvent(event, previous)
    if (rebuilt.eventHash !== event.eventHash) {
      return { valid: false, invalidEventId: event.eventId }
    }
    previous = event.eventHash
  }
  return { valid: true, invalidEventId: null }
}
