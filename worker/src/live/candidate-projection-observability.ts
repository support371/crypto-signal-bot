import { canonicalHash } from './canonical-json.ts'
import type { CandidateProjectionStatus } from './candidate-projection-retry.ts'
import {
  acknowledgeAlert,
  openOrRefreshAlert,
  recordMetricSample,
  resolveAlert,
  type ObservabilityEnv,
} from './observability-store.ts'
import type { OperationalAlert } from './observability.ts'
import {
  evaluateAuthorization,
  recordAuthorizationDecision,
  type AuthorizationDecision,
  type ScopedRole,
  type StepUpSession,
} from './authorization.ts'

export interface CandidateProjectionObservation {
  exchangeAccountId: string
  assessmentId: string
  projectionEventId: string
  status: CandidateProjectionStatus
  attemptCount: number
  firstFailedAt: string | null
  nextAttemptAt: string | null
  lastErrorCode: string | null
  observedAt: string
}

export interface CandidateProjectionObservabilityThresholds {
  maximumProjectionLagMs: number
}

export interface CandidateProjectionMetric {
  metricName: string
  metricValue: string
  metricUnit: string
  labels: Readonly<Record<string, string | number | boolean | null>>
}

export interface CandidateProjectionObservabilityEvaluation {
  projectionLagMs: number
  metrics: readonly CandidateProjectionMetric[]
  alerts: readonly OperationalAlert[]
}

export interface CandidateProjectionObservabilityResult {
  metricsRecorded: number
  alertsOpenedOrRefreshed: number
  alertsResolved: number
  executionAllowed: false
  reservationApplied: false
  projectionRetried: false
}

export interface ProjectionAlertAcknowledgementInput {
  alertId: string
  actorId: string
  exchangeName: string
  exchangeAccountId: string
  roles: readonly ScopedRole[]
  stepUpSession: StepUpSession | null
  evaluatedAt: string
  authorizationEventId: string
  alertEventId: string
  correlationId: string
  authorizationAuditEventHash: string
  acknowledgementAuditEventHash: string
  detail: Readonly<Record<string, string | number | boolean | null>>
}

export interface ProjectionAlertAcknowledgementResult {
  acknowledged: boolean
  authorization: AuthorizationDecision | null
  reasons: readonly string[]
  executionAllowed: false
  reservationApplied: false
  projectionRetried: false
}

type ProjectionAlertRow = {
  alert_id: string
  reason_code: string
  exchange_account_id: string | null
}

const PROJECTION_ALERT_REASONS = new Set([
  'CANDIDATE_PROJECTION_LAG_EXCEEDED',
  'CANDIDATE_PROJECTION_CONFLICT',
  'CANDIDATE_PROJECTION_DEAD_LETTER',
])

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function isoTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`)
  }
  return value
}

function projectionLagMs(observation: CandidateProjectionObservation): number {
  const observedAt = Date.parse(isoTimestamp(observation.observedAt, 'observedAt'))
  if (observation.firstFailedAt === null) return 0
  const failedAt = Date.parse(isoTimestamp(observation.firstFailedAt, 'firstFailedAt'))
  return Math.max(0, observedAt - failedAt)
}

function projectionAlert(
  observation: CandidateProjectionObservation,
  suffix: string,
  severity: OperationalAlert['severity'],
  reasonCode: string,
  summary: string,
  detail: OperationalAlert['detail'],
): OperationalAlert {
  return {
    alertKey: `candidate-projection-${suffix}:${observation.projectionEventId}`,
    severity,
    reasonCode,
    summary,
    detail: {
      assessmentId: observation.assessmentId,
      projectionEventId: observation.projectionEventId,
      projectionStatus: observation.status,
      attemptCount: observation.attemptCount,
      lastErrorCode: observation.lastErrorCode,
      ...detail,
    },
    guardianAction: 'NONE',
  }
}

export function defaultCandidateProjectionObservabilityThresholds(): CandidateProjectionObservabilityThresholds {
  return Object.freeze({ maximumProjectionLagMs: 5 * 60_000 })
}

export function evaluateCandidateProjectionObservability(
  observation: CandidateProjectionObservation,
  thresholds: CandidateProjectionObservabilityThresholds = defaultCandidateProjectionObservabilityThresholds(),
): CandidateProjectionObservabilityEvaluation {
  required(observation.exchangeAccountId, 'exchangeAccountId')
  required(observation.assessmentId, 'assessmentId')
  required(observation.projectionEventId, 'projectionEventId')
  nonNegativeSafeInteger(observation.attemptCount, 'attemptCount')
  isoTimestamp(observation.observedAt, 'observedAt')
  if (observation.nextAttemptAt !== null) isoTimestamp(observation.nextAttemptAt, 'nextAttemptAt')
  if (!Number.isSafeInteger(thresholds.maximumProjectionLagMs) || thresholds.maximumProjectionLagMs < 1_000) {
    throw new RangeError('maximumProjectionLagMs must be a safe integer of at least 1000')
  }

  const lagMs = projectionLagMs(observation)
  const labels = Object.freeze({
    assessmentId: observation.assessmentId,
    projectionEventId: observation.projectionEventId,
    projectionStatus: observation.status,
  })
  const metrics: CandidateProjectionMetric[] = [
    {
      metricName: 'candidate_projection_lag_ms',
      metricValue: String(lagMs),
      metricUnit: 'milliseconds',
      labels,
    },
    {
      metricName: 'candidate_projection_attempt_count',
      metricValue: String(observation.attemptCount),
      metricUnit: 'count',
      labels,
    },
    {
      metricName: 'candidate_projection_conflict',
      metricValue: observation.status === 'CONFLICT' ? '1' : '0',
      metricUnit: 'boolean',
      labels,
    },
    {
      metricName: 'candidate_projection_dead_letter',
      metricValue: observation.status === 'DEAD_LETTER' ? '1' : '0',
      metricUnit: 'boolean',
      labels,
    },
  ]

  const alerts: OperationalAlert[] = []
  if (lagMs > thresholds.maximumProjectionLagMs) {
    alerts.push(projectionAlert(
      observation,
      'lag',
      'CRITICAL',
      'CANDIDATE_PROJECTION_LAG_EXCEEDED',
      'Candidate evidence projection exceeded the maximum reporting lag',
      {
        observedLagMs: lagMs,
        limitMs: thresholds.maximumProjectionLagMs,
        recovered: observation.status === 'PROJECTED',
      },
    ))
  }
  if (observation.status === 'CONFLICT') {
    alerts.push(projectionAlert(
      observation,
      'conflict',
      'CRITICAL',
      'CANDIDATE_PROJECTION_CONFLICT',
      'Candidate evidence projection was quarantined because stored evidence conflicted',
      { terminal: true },
    ))
  }
  if (observation.status === 'DEAD_LETTER') {
    alerts.push(projectionAlert(
      observation,
      'dead-letter',
      'CRITICAL',
      'CANDIDATE_PROJECTION_DEAD_LETTER',
      'Candidate evidence projection exhausted its bounded retry budget',
      { terminal: true },
    ))
  }

  return Object.freeze({
    projectionLagMs: lagMs,
    metrics: Object.freeze(metrics),
    alerts: Object.freeze(alerts),
  })
}

async function stableId(prefix: string, value: unknown): Promise<string> {
  return `${prefix}-${(await canonicalHash(value)).slice(0, 40)}`
}

export async function persistCandidateProjectionObservability(
  env: ObservabilityEnv,
  observation: CandidateProjectionObservation,
  thresholds: CandidateProjectionObservabilityThresholds = defaultCandidateProjectionObservabilityThresholds(),
): Promise<CandidateProjectionObservabilityResult> {
  const evaluation = evaluateCandidateProjectionObservability(observation, thresholds)
  let metricsRecorded = 0
  let alertsOpenedOrRefreshed = 0
  let alertsResolved = 0

  for (const metric of evaluation.metrics) {
    await recordMetricSample(env, {
      metricSampleId: await stableId('projection-metric', {
        projectionEventId: observation.projectionEventId,
        attemptCount: observation.attemptCount,
        status: observation.status,
        observedAt: observation.observedAt,
        metricName: metric.metricName,
      }),
      exchangeAccountId: observation.exchangeAccountId,
      metricName: metric.metricName,
      metricValue: metric.metricValue,
      metricUnit: metric.metricUnit,
      labels: metric.labels,
      observedAt: observation.observedAt,
    })
    metricsRecorded += 1
  }

  for (const alert of evaluation.alerts) {
    const alertId = await stableId('projection-alert', {
      exchangeAccountId: observation.exchangeAccountId,
      alertKey: alert.alertKey,
    })
    const correlationId = `candidate-projection:${observation.projectionEventId}`
    await openOrRefreshAlert(env, {
      alertId,
      alertEventId: await stableId('projection-alert-event', {
        alertKey: alert.alertKey,
        status: observation.status,
        attemptCount: observation.attemptCount,
        observedAt: observation.observedAt,
      }),
      exchangeAccountId: observation.exchangeAccountId,
      alert,
      correlationId,
      auditEventHash: await canonicalHash({
        action: 'OPEN_OR_REFRESH_PROJECTION_ALERT',
        observation,
        alert,
      }),
      observedAt: observation.observedAt,
    })
    alertsOpenedOrRefreshed += 1

    if (
      observation.status === 'PROJECTED'
      && alert.reasonCode === 'CANDIDATE_PROJECTION_LAG_EXCEEDED'
    ) {
      const resolved = await resolveAlert(env, {
        alertId,
        alertEventId: await stableId('projection-alert-resolution', {
          alertId,
          observedAt: observation.observedAt,
        }),
        actorId: null,
        reasonCode: 'CANDIDATE_PROJECTION_RECOVERED',
        detail: {
          projectionEventId: observation.projectionEventId,
          projectionLagMs: evaluation.projectionLagMs,
          executionAllowed: false,
        },
        correlationId,
        auditEventHash: await canonicalHash({
          action: 'RESOLVE_RECOVERED_PROJECTION_ALERT',
          observation,
        }),
        occurredAt: observation.observedAt,
      })
      if (resolved) alertsResolved += 1
    }
  }

  return Object.freeze({
    metricsRecorded,
    alertsOpenedOrRefreshed,
    alertsResolved,
    executionAllowed: false,
    reservationApplied: false,
    projectionRetried: false,
  })
}

export async function authorizeAndAcknowledgeProjectionAlert(
  env: ObservabilityEnv,
  input: ProjectionAlertAcknowledgementInput,
): Promise<ProjectionAlertAcknowledgementResult> {
  const alertId = required(input.alertId, 'alertId')
  const row = await env.DB.prepare(`
    SELECT alert_id, reason_code, exchange_account_id
      FROM live_alerts
     WHERE alert_id = ?
     LIMIT 1
  `).bind(alertId).first<ProjectionAlertRow>()

  if (
    !row
    || !PROJECTION_ALERT_REASONS.has(row.reason_code)
    || row.exchange_account_id !== required(input.exchangeAccountId, 'exchangeAccountId')
  ) {
    return Object.freeze({
      acknowledged: false,
      authorization: null,
      reasons: Object.freeze(['projection_alert_not_found']),
      executionAllowed: false,
      reservationApplied: false,
      projectionRetried: false,
    })
  }

  const request = {
    actorId: required(input.actorId, 'actorId'),
    action: 'ACKNOWLEDGE_ALERT' as const,
    resourceType: 'OPERATIONAL_ALERT',
    resourceId: alertId,
    exchangeName: required(input.exchangeName, 'exchangeName'),
    exchangeAccountId: input.exchangeAccountId,
    resourceOwnerActorId: null,
    roles: input.roles,
    stepUpSession: input.stepUpSession,
    evaluatedAt: isoTimestamp(input.evaluatedAt, 'evaluatedAt'),
  }
  const authorization = evaluateAuthorization(request)

  await recordAuthorizationDecision(env, {
    authorizationEventId: required(input.authorizationEventId, 'authorizationEventId'),
    request,
    decision: authorization,
    correlationId: required(input.correlationId, 'correlationId'),
    auditEventHash: input.authorizationAuditEventHash,
  })

  if (!authorization.allowed) {
    return Object.freeze({
      acknowledged: false,
      authorization,
      reasons: Object.freeze([...authorization.reasons]),
      executionAllowed: false,
      reservationApplied: false,
      projectionRetried: false,
    })
  }

  const acknowledged = await acknowledgeAlert(env, {
    alertId,
    alertEventId: required(input.alertEventId, 'alertEventId'),
    actorId: input.actorId,
    reasonCode: 'PROJECTION_ALERT_ACKNOWLEDGED',
    detail: {
      ...input.detail,
      authorizationEventId: input.authorizationEventId,
      executionAllowed: false,
      reservationApplied: false,
      projectionRetried: false,
    },
    correlationId: input.correlationId,
    auditEventHash: input.acknowledgementAuditEventHash,
    occurredAt: input.evaluatedAt,
  })

  return Object.freeze({
    acknowledged,
    authorization,
    reasons: Object.freeze(acknowledged ? [] : ['alert_not_open']),
    executionAllowed: false,
    reservationApplied: false,
    projectionRetried: false,
  })
}
