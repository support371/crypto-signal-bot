import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import {
  defaultCandidateThresholds,
  evaluateOperationalAlerts,
} from '../src/live/observability.ts'

const healthy = {
  exchangeAccountId: 'account-ref-hash',
  unresolvedOrders: 0,
  reconciliationAgeMs: 10_000,
  marketFeedAgeMs: 1_000,
  userStreamAgeMs: 2_000,
  queueDeadLetters: 0,
  authenticationErrors: 0,
  orderRejections: 0,
  balanceDrift: asDecimalString('0'),
  ledgerImbalance: asDecimalString('0'),
  withdrawalAnomalies: 0,
  releaseMatchesDeployment: true,
  guardianHalted: false,
  candidateExecutionLocked: true,
  observedAt: '2026-07-17T10:00:00.000Z',
}

test('healthy candidate evidence emits no operational alert', () => {
  const alerts = evaluateOperationalAlerts(healthy, defaultCandidateThresholds())
  assert.deepEqual(alerts, [])
})

test('execution unlock and release mismatch are critical account halts', () => {
  const alerts = evaluateOperationalAlerts({
    ...healthy,
    candidateExecutionLocked: false,
    releaseMatchesDeployment: false,
  }, defaultCandidateThresholds())

  assert.equal(alerts.length, 2)
  assert.ok(alerts.every((item) => item.severity === 'CRITICAL'))
  assert.ok(alerts.every((item) => item.guardianAction === 'HALT_ACCOUNT'))
  assert.deepEqual(alerts.map((item) => item.alertKey), [
    'candidate-execution-unlocked',
    'release-deployment-mismatch',
  ])
})

test('stale reconciliation and streams fail closed', () => {
  const alerts = evaluateOperationalAlerts({
    ...healthy,
    reconciliationAgeMs: null,
    marketFeedAgeMs: 20_000,
    userStreamAgeMs: 31_000,
  }, defaultCandidateThresholds())

  assert.deepEqual(alerts.map((item) => item.reasonCode), [
    'MARKET_FEED_STALE',
    'RECONCILIATION_STALE',
    'USER_STREAM_STALE',
  ])
})

test('financial drift and dead letters trigger deterministic restrictions', () => {
  const alerts = evaluateOperationalAlerts({
    ...healthy,
    queueDeadLetters: 1,
    balanceDrift: asDecimalString('0.01'),
    ledgerImbalance: asDecimalString('0.00000001'),
  }, defaultCandidateThresholds())

  assert.equal(
    alerts.find((item) => item.alertKey === 'balance-drift')?.guardianAction,
    'HALT_ACCOUNT',
  )
  assert.equal(
    alerts.find((item) => item.alertKey === 'ledger-imbalance')?.guardianAction,
    'HALT_ACCOUNT',
  )
  assert.equal(
    alerts.find((item) => item.alertKey === 'queue-dead-letters')?.guardianAction,
    'RESTRICT_ACCOUNT',
  )
})

test('withdrawal anomalies halt the withdrawal scope only', () => {
  const alerts = evaluateOperationalAlerts({
    ...healthy,
    withdrawalAnomalies: 1,
  }, defaultCandidateThresholds())

  assert.deepEqual(alerts, [{
    alertKey: 'withdrawal-anomalies',
    severity: 'CRITICAL',
    reasonCode: 'WITHDRAWAL_ANOMALIES_EXCEEDED',
    summary: 'Withdrawal anomalies exceed the configured limit',
    detail: { observed: 1, limit: 0 },
    guardianAction: 'HALT_WITHDRAWALS',
  }])
})

test('existing Guardian halt is represented as informational state', () => {
  const alerts = evaluateOperationalAlerts({
    ...healthy,
    guardianHalted: true,
  }, defaultCandidateThresholds())

  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].severity, 'INFO')
  assert.equal(alerts[0].guardianAction, 'NONE')
})
