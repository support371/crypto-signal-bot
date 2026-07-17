import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function requirePattern(content, pattern, message, failures) {
  if (!pattern.test(content)) failures.push(message)
}

const failures = []
const entrypoint = read('worker/src/index_live_candidate.ts')
const wrapper = read('worker/src/live/observed-account-coordinator.ts')
const projectionObservability = read('worker/src/live/candidate-projection-observability.ts')
const observabilityStore = read('worker/src/live/observability-store.ts')
const authorization = read('worker/src/live/authorization.ts')

requirePattern(
  entrypoint,
  /export \{ ExchangeAccountCoordinator \} from '\.\/live\/observed-account-coordinator'/,
  'live candidate must export the observability-decorated coordinator',
  failures,
)
requirePattern(wrapper, /BaseExchangeAccountCoordinator/, 'decorator must delegate to the tested base coordinator', failures)
requirePattern(wrapper, /candidate_projection_observability_cursor/, 'durable observability cursor is missing', failures)
requirePattern(wrapper, /candidate_projection_events/, 'decorator must consume append-only projection events', failures)
requirePattern(wrapper, /persistCandidateProjectionObservability/, 'projection observability persistence call is missing', failures)
requirePattern(wrapper, /await persistCandidateProjectionObservability[\s\S]*this\.markDelivered/, 'cursor must advance only after observability persistence', failures)
requirePattern(wrapper, /catch \(error\)[\s\S]*this\.markDeliveryFailure[\s\S]*scheduleAlarmNoLaterThan[\s\S]*return/, 'observability failure must retain the cursor and schedule retry', failures)
requirePattern(wrapper, /OBSERVABILITY_RETRY_DELAY_MS\s*=\s*60_000/, 'observability retry delay must be one minute', failures)
requirePattern(wrapper, /getAlarm\(\)/, 'observability retry must preserve an earlier coordinator alarm', failures)
requirePattern(wrapper, /MAX_OBSERVABILITY_EVENTS_PER_PASS\s*=\s*50/, 'observability delivery batch must remain bounded', failures)
requirePattern(wrapper, /rows\.length === MAX_OBSERVABILITY_EVENTS_PER_PASS[\s\S]*scheduleAlarmNoLaterThan/, 'full observability batches must schedule continuation', failures)
requirePattern(wrapper, /executionAllowed !== false/, 'stored evidence execution-lock validation is missing', failures)
requirePattern(wrapper, /const response = await this\.inner\.fetch\(request\)/, 'decorator must preserve authoritative fetch response', failures)
requirePattern(wrapper, /await this\.inner\.alarm\(\)/, 'decorator must preserve authoritative alarm behavior', failures)

requirePattern(projectionObservability, /candidate_projection_lag_ms/, 'projection lag metric is missing', failures)
requirePattern(projectionObservability, /candidate_projection_attempt_count/, 'projection attempt metric is missing', failures)
requirePattern(projectionObservability, /CANDIDATE_PROJECTION_LAG_EXCEEDED/, 'projection lag alert is missing', failures)
requirePattern(projectionObservability, /CANDIDATE_PROJECTION_CONFLICT/, 'projection conflict alert is missing', failures)
requirePattern(projectionObservability, /CANDIDATE_PROJECTION_DEAD_LETTER/, 'projection dead-letter alert is missing', failures)
requirePattern(projectionObservability, /guardianAction:\s*'NONE'/, 'projection alerts must not mutate Guardian state', failures)
requirePattern(projectionObservability, /recordMetricSample/, 'metric-store integration is missing', failures)
requirePattern(projectionObservability, /openOrRefreshAlert/, 'alert-store integration is missing', failures)
requirePattern(projectionObservability, /resolveAlert/, 'recovered lag alert resolution is missing', failures)
requirePattern(projectionObservability, /evaluateAuthorization/, 'alert acknowledgment authorization is missing', failures)
requirePattern(projectionObservability, /recordAuthorizationDecision/, 'authorization decision audit recording is missing', failures)
requirePattern(projectionObservability, /acknowledgeAlert/, 'immutable acknowledgment event integration is missing', failures)
requirePattern(projectionObservability, /projectionRetried:\s*false/, 'acknowledgment must not retry projection', failures)
requirePattern(projectionObservability, /reservationApplied:\s*false/, 'acknowledgment must not apply reservation', failures)
requirePattern(projectionObservability, /executionAllowed:\s*false/, 'acknowledgment must not allow execution', failures)

requirePattern(authorization, /\| 'ACKNOWLEDGE_ALERT'/, 'alert acknowledgment authorization action is missing', failures)
requirePattern(authorization, /ACKNOWLEDGE_ALERT:[\s\S]*anyRole: \['RISK_OPERATOR', 'RISK_ADMIN'\]/, 'alert acknowledgment must require risk operator or admin', failures)
requirePattern(authorization, /ACKNOWLEDGE_ALERT:[\s\S]*stepUpRequired:\s*true/, 'alert acknowledgment must require step-up', failures)
requirePattern(authorization, /ACKNOWLEDGE_ALERT:[\s\S]*stepUpAudience:\s*'operations'/, 'alert acknowledgment step-up audience must be operations', failures)

requirePattern(observabilityStore, /INSERT OR IGNORE INTO live_metric_samples/, 'metric replay must be idempotent', failures)
requirePattern(observabilityStore, /SELECT alert_event_id FROM live_alert_events WHERE alert_event_id = \?/, 'alert event replay guard is missing', failures)

for (const forbidden of [
  /createOrder/,
  /cancelOrder/,
  /replaceOrder/,
  /requestWithdrawal/,
  /applyReservation/,
  /executionAllowed:\s*true/,
  /projectionRetried:\s*true/,
  /reservationApplied:\s*true/,
]) {
  if (wrapper.match(forbidden) || projectionObservability.match(forbidden)) {
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
