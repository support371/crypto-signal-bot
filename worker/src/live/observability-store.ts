import { canonicalJson } from './canonical-json.ts'
import type { OperationalAlert } from './observability.ts'

export interface ObservabilityEnv {
  DB: D1Database
}

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

export async function recordMetricSample(
  env: ObservabilityEnv,
  input: {
    metricSampleId: string
    exchangeAccountId: string | null
    metricName: string
    metricValue: string
    metricUnit: string
    labels: Readonly<Record<string, string | number | boolean | null>>
    observedAt: string
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO live_metric_samples (
       metric_sample_id, exchange_account_id, metric_name, metric_value,
       metric_unit, labels_json, observed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    required(input.metricSampleId, 'metricSampleId'),
    input.exchangeAccountId?.trim() || null,
    required(input.metricName, 'metricName'),
    required(input.metricValue, 'metricValue'),
    required(input.metricUnit, 'metricUnit'),
    canonicalJson(input.labels),
    timestamp(input.observedAt, 'observedAt'),
  ).run()
}

export async function openOrRefreshAlert(
  env: ObservabilityEnv,
  input: {
    alertId: string
    alertEventId: string
    exchangeAccountId: string | null
    alert: OperationalAlert
    correlationId: string
    auditEventHash: string
    observedAt: string
  },
): Promise<void> {
  const alertEventId = required(input.alertEventId, 'alertEventId')
  const replay = await env.DB.prepare(
    'SELECT alert_event_id FROM live_alert_events WHERE alert_event_id = ? LIMIT 1',
  ).bind(alertEventId).first<{ alert_event_id: string }>()
  if (replay) return

  const observedAt = timestamp(input.observedAt, 'observedAt')
  const existing = await env.DB.prepare(
    `SELECT alert_id, status
       FROM live_alerts
      WHERE exchange_account_id IS ? AND alert_key = ?
      LIMIT 1`,
  ).bind(
    input.exchangeAccountId?.trim() || null,
    input.alert.alertKey,
  ).first<{ alert_id: string; status: string }>()
  const alertId = existing?.alert_id ?? required(input.alertId, 'alertId')
  const previousStatus = existing?.status ?? null

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO live_alerts (
         alert_id, exchange_account_id, alert_key, severity, status,
         reason_code, summary, detail_json, first_observed_at,
         last_observed_at, occurrence_count
       ) VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, 1)
       ON CONFLICT(exchange_account_id, alert_key) DO UPDATE SET
         severity = excluded.severity,
         status = 'OPEN',
         reason_code = excluded.reason_code,
         summary = excluded.summary,
         detail_json = excluded.detail_json,
         last_observed_at = excluded.last_observed_at,
         occurrence_count = live_alerts.occurrence_count + 1,
         resolved_at = NULL,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      alertId,
      input.exchangeAccountId?.trim() || null,
      input.alert.alertKey,
      input.alert.severity,
      input.alert.reasonCode,
      input.alert.summary,
      canonicalJson({
        ...input.alert.detail,
        guardianAction: input.alert.guardianAction,
      }),
      observedAt,
      observedAt,
    ),
    env.DB.prepare(
      `INSERT INTO live_alert_events (
         alert_event_id, alert_id, previous_status, next_status, actor_id,
         reason_code, detail_json, correlation_id, audit_event_hash,
         occurred_at
       ) VALUES (?, ?, ?, 'OPEN', NULL, ?, ?, ?, ?, ?)`,
    ).bind(
      alertEventId,
      alertId,
      previousStatus,
      input.alert.reasonCode,
      canonicalJson({
        ...input.alert.detail,
        guardianAction: input.alert.guardianAction,
      }),
      required(input.correlationId, 'correlationId'),
      hash(input.auditEventHash, 'auditEventHash'),
      observedAt,
    ),
  ])
}

export async function acknowledgeAlert(
  env: ObservabilityEnv,
  input: {
    alertId: string
    alertEventId: string
    actorId: string
    reasonCode: string
    detail: unknown
    correlationId: string
    auditEventHash: string
    occurredAt: string
  },
): Promise<boolean> {
  const current = await env.DB.prepare(
    'SELECT status FROM live_alerts WHERE alert_id = ? LIMIT 1',
  ).bind(input.alertId).first<{ status: string }>()
  if (!current || current.status !== 'OPEN') return false
  const occurredAt = timestamp(input.occurredAt, 'occurredAt')

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE live_alerts
          SET status = 'ACKNOWLEDGED', acknowledged_by = ?,
              acknowledged_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE alert_id = ? AND status = 'OPEN'`,
    ).bind(
      required(input.actorId, 'actorId'),
      occurredAt,
      required(input.alertId, 'alertId'),
    ),
    env.DB.prepare(
      `INSERT INTO live_alert_events (
         alert_event_id, alert_id, previous_status, next_status, actor_id,
         reason_code, detail_json, correlation_id, audit_event_hash,
         occurred_at
       ) VALUES (?, ?, 'OPEN', 'ACKNOWLEDGED', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      required(input.alertEventId, 'alertEventId'),
      input.alertId,
      input.actorId,
      required(input.reasonCode, 'reasonCode'),
      canonicalJson(input.detail),
      required(input.correlationId, 'correlationId'),
      hash(input.auditEventHash, 'auditEventHash'),
      occurredAt,
    ),
  ])
  return true
}

export async function resolveAlert(
  env: ObservabilityEnv,
  input: {
    alertId: string
    alertEventId: string
    actorId: string | null
    reasonCode: string
    detail: unknown
    correlationId: string
    auditEventHash: string
    occurredAt: string
  },
): Promise<boolean> {
  const current = await env.DB.prepare(
    'SELECT status FROM live_alerts WHERE alert_id = ? LIMIT 1',
  ).bind(input.alertId).first<{ status: string }>()
  if (!current || !['OPEN', 'ACKNOWLEDGED'].includes(current.status)) return false
  const occurredAt = timestamp(input.occurredAt, 'occurredAt')

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE live_alerts
          SET status = 'RESOLVED', resolved_at = ?, updated_at = CURRENT_TIMESTAMP
        WHERE alert_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED')`,
    ).bind(occurredAt, required(input.alertId, 'alertId')),
    env.DB.prepare(
      `INSERT INTO live_alert_events (
         alert_event_id, alert_id, previous_status, next_status, actor_id,
         reason_code, detail_json, correlation_id, audit_event_hash,
         occurred_at
       ) VALUES (?, ?, ?, 'RESOLVED', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      required(input.alertEventId, 'alertEventId'),
      input.alertId,
      current.status,
      input.actorId?.trim() || null,
      required(input.reasonCode, 'reasonCode'),
      canonicalJson(input.detail),
      required(input.correlationId, 'correlationId'),
      hash(input.auditEventHash, 'auditEventHash'),
      occurredAt,
    ),
  ])
  return true
}
