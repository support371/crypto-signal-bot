import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultCandidateProjectionObservabilityThresholds,
  evaluateCandidateProjectionObservability,
  type CandidateProjectionObservation,
} from '../src/live/candidate-projection-observability.ts'

function observation(overrides: Partial<CandidateProjectionObservation> = {}): CandidateProjectionObservation {
  return {
    exchangeAccountId: 'bitget-account-ref',
    assessmentId: 'candidate-assessment-1',
    projectionEventId: 'candidate-projection-1',
    status: 'PENDING',
    attemptCount: 1,
    firstFailedAt: '2026-07-17T20:00:00.000Z',
    nextAttemptAt: '2026-07-17T20:02:00.000Z',
    lastErrorCode: 'NETWORK_ERROR',
    observedAt: '2026-07-17T20:01:00.000Z',
    ...overrides,
  }
}

test('projection observation emits four deterministic operational metrics', () => {
  const evaluation = evaluateCandidateProjectionObservability(observation())

  assert.equal(evaluation.projectionLagMs, 60_000)
  assert.deepEqual(evaluation.metrics.map((metric) => metric.metricName), [
    'candidate_projection_lag_ms',
    'candidate_projection_attempt_count',
    'candidate_projection_conflict',
    'candidate_projection_dead_letter',
  ])
  assert.deepEqual(evaluation.metrics.map((metric) => metric.metricValue), [
    '60000',
    '1',
    '0',
    '0',
  ])
  assert.deepEqual(evaluation.alerts, [])
})

test('projection lag beyond the threshold creates a critical non-mutating alert', () => {
  const evaluation = evaluateCandidateProjectionObservability(observation({
    observedAt: '2026-07-17T20:06:00.001Z',
  }))

  assert.equal(evaluation.alerts.length, 1)
  const alert = evaluation.alerts[0]
  assert.equal(alert.severity, 'CRITICAL')
  assert.equal(alert.reasonCode, 'CANDIDATE_PROJECTION_LAG_EXCEEDED')
  assert.equal(alert.guardianAction, 'NONE')
  assert.equal(alert.detail.observedLagMs, 360_001)
  assert.equal(alert.detail.recovered, false)
})

test('recovered projection preserves lag incident evidence for immediate resolution', () => {
  const evaluation = evaluateCandidateProjectionObservability(observation({
    status: 'PROJECTED',
    attemptCount: 4,
    nextAttemptAt: null,
    lastErrorCode: null,
    observedAt: '2026-07-17T20:10:00.000Z',
  }))

  assert.equal(evaluation.alerts.length, 1)
  assert.equal(evaluation.alerts[0].reasonCode, 'CANDIDATE_PROJECTION_LAG_EXCEEDED')
  assert.equal(evaluation.alerts[0].detail.recovered, true)
  assert.equal(evaluation.metrics[2].metricValue, '0')
  assert.equal(evaluation.metrics[3].metricValue, '0')
})

test('projection conflicts are critical and terminal without Guardian mutation', () => {
  const evaluation = evaluateCandidateProjectionObservability(observation({
    status: 'CONFLICT',
    attemptCount: 2,
    nextAttemptAt: null,
    lastErrorCode: 'CANDIDATE_EVIDENCE_CONFLICT',
  }))

  const alert = evaluation.alerts.find((item) => item.reasonCode === 'CANDIDATE_PROJECTION_CONFLICT')
  assert.ok(alert)
  assert.equal(alert.severity, 'CRITICAL')
  assert.equal(alert.guardianAction, 'NONE')
  assert.equal(alert.detail.terminal, true)
  assert.equal(evaluation.metrics[2].metricValue, '1')
})

test('dead-lettered projections create critical terminal alerts', () => {
  const evaluation = evaluateCandidateProjectionObservability(observation({
    status: 'DEAD_LETTER',
    attemptCount: 8,
    nextAttemptAt: null,
    lastErrorCode: 'NETWORK_ERROR',
    observedAt: '2026-07-17T21:00:00.000Z',
  }))

  assert.ok(evaluation.alerts.some(
    (item) => item.reasonCode === 'CANDIDATE_PROJECTION_DEAD_LETTER',
  ))
  assert.equal(evaluation.metrics[3].metricValue, '1')
})

test('projection observability thresholds and timestamps fail closed', () => {
  assert.throws(
    () => evaluateCandidateProjectionObservability(observation({ observedAt: 'invalid' })),
    /observedAt must be ISO-8601/,
  )
  assert.throws(
    () => evaluateCandidateProjectionObservability(
      observation(),
      { maximumProjectionLagMs: 999 },
    ),
    /maximumProjectionLagMs must be a safe integer of at least 1000/,
  )
  assert.deepEqual(defaultCandidateProjectionObservabilityThresholds(), {
    maximumProjectionLagMs: 300_000,
  })
})
