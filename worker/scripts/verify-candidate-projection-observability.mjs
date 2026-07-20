import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const failures = []
const entrypoint = read('worker/src/index_live_candidate.ts')
const wrapper = read('worker/src/live/observed-account-coordinator.ts')
const projectionObservability = read('worker/src/live/candidate-projection-observability.ts')
const observabilityStore = read('worker/src/live/observability-store.ts')
const authorization = read('worker/src/live/authorization.ts')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

function requireOrdered(content, tokens, message) {
  let cursor = -1
  for (const token of tokens) {
    const next = content.indexOf(token, cursor + 1)
    if (next < 0) {
      failures.push(message)
      return
    }
    cursor = next
  }
}

requireToken(
  entrypoint,
  "export { ExchangeAccountCoordinator } from './live/observed-account-coordinator'",
  'live candidate must export the observability-decorated coordinator',
)

for (const [token, message] of [
  ['BaseExchangeAccountCoordinator', 'decorator must delegate to the tested base coordinator'],
  ['candidate_projection_observability_cursor', 'durable observability cursor is missing'],
  ['candidate_projection_events', 'decorator must consume append-only projection events'],
  ['persistCandidateProjectionObservability', 'projection observability persistence call is missing'],
  ['OBSERVABILITY_RETRY_DELAY_MS = 60_000', 'observability retry delay must be one minute'],
  ['getAlarm()', 'observability retry must preserve an earlier coordinator alarm'],
  ['MAX_OBSERVABILITY_EVENTS_PER_PASS = 50', 'observability delivery batch must remain bounded'],
  ['rows.length === MAX_OBSERVABILITY_EVENTS_PER_PASS', 'full observability batch continuation check is missing'],
  ['parsed.executionAllowed !== false', 'stored evidence execution-lock validation is missing'],
  ['const response = await this.inner.fetch(request)', 'decorator must preserve authoritative fetch response'],
  ['await this.inner.alarm()', 'decorator must preserve authoritative alarm behavior'],
]) {
  requireToken(wrapper, token, message)
}

requireOrdered(
  wrapper,
  [
    'await persistCandidateProjectionObservability',
    'this.markDelivered(row.sequence_id, row.occurred_at)',
  ],
  'cursor must advance only after observability persistence',
)
requireOrdered(
  wrapper,
  [
    'catch (error)',
    'this.markDeliveryFailure(error',
    'await this.scheduleAlarmNoLaterThan(Date.now() + OBSERVABILITY_RETRY_DELAY_MS)',
    'return',
  ],
  'observability failure must retain the cursor and schedule retry',
)
requireOrdered(
  wrapper,
  [
    'rows.length === MAX_OBSERVABILITY_EVENTS_PER_PASS',
    'await this.scheduleAlarmNoLaterThan(Date.now() + 1_000)',
  ],
  'full observability batches must schedule continuation',
)

for (const [token, message] of [
  ['candidate_projection_lag_ms', 'projection lag metric is missing'],
  ['candidate_projection_attempt_count', 'projection attempt metric is missing'],
  ['CANDIDATE_PROJECTION_LAG_EXCEEDED', 'projection lag alert is missing'],
  ['CANDIDATE_PROJECTION_CONFLICT', 'projection conflict alert is missing'],
  ['CANDIDATE_PROJECTION_DEAD_LETTER', 'projection dead-letter alert is missing'],
  ["guardianAction: 'NONE'", 'projection alerts must not mutate Guardian state'],
  ['recordMetricSample', 'metric-store integration is missing'],
  ['openOrRefreshAlert', 'alert-store integration is missing'],
  ['resolveAlert', 'recovered lag alert resolution is missing'],
  ['evaluateAuthorization', 'alert acknowledgment authorization is missing'],
  ['recordAuthorizationDecision', 'authorization decision audit recording is missing'],
  ['acknowledgeAlert', 'immutable acknowledgment event integration is missing'],
  ['projectionRetried: false', 'acknowledgment must not retry projection'],
  ['reservationApplied: false', 'acknowledgment must not apply reservation'],
  ['executionAllowed: false', 'acknowledgment must not allow execution'],
]) {
  requireToken(projectionObservability, token, message)
}

for (const [token, message] of [
  ["| 'ACKNOWLEDGE_ALERT'", 'alert acknowledgment authorization action is missing'],
  ['ACKNOWLEDGE_ALERT: {', 'alert acknowledgment authorization policy is missing'],
  ["anyRole: ['RISK_OPERATOR', 'RISK_ADMIN']", 'alert acknowledgment must require risk operator or admin'],
  ['stepUpRequired: true', 'alert acknowledgment must require step-up'],
  ["stepUpAudience: 'operations'", 'alert acknowledgment step-up audience must be operations'],
]) {
  requireToken(authorization, token, message)
}
requireOrdered(
  authorization,
  [
    'ACKNOWLEDGE_ALERT: {',
    "anyRole: ['RISK_OPERATOR', 'RISK_ADMIN']",
    'stepUpRequired: true',
    "stepUpAudience: 'operations'",
  ],
  'alert acknowledgment policy fields must remain together and ordered',
)

requireToken(
  observabilityStore,
  'INSERT OR IGNORE INTO live_metric_samples',
  'metric replay must be idempotent',
)
requireToken(
  observabilityStore,
  'SELECT alert_event_id FROM live_alert_events WHERE alert_event_id = ? LIMIT 1',
  'alert event replay guard is missing',
)

for (const forbidden of [
  'createOrder',
  'cancelOrder',
  'replaceOrder',
  'requestWithdrawal',
  'applyReservation',
  'executionAllowed: true',
  'projectionRetried: true',
  'reservationApplied: true',
]) {
  if (wrapper.includes(forbidden) || projectionObservability.includes(forbidden)) {
    failures.push(`forbidden observability or acknowledgment capability detected: ${forbidden}`)
  }
}

if (entrypoint.includes('/candidate/projection-alerts') || entrypoint.includes('/acknowledge-alert')) {
  failures.push('projection alert acknowledgment must not be publicly exposed by the candidate Worker')
}

if (failures.length > 0) {
  console.error('Candidate projection observability verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Candidate projection observability verification passed.')
