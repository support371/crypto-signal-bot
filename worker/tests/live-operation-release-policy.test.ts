import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateLiveOperationRelease, type LiveOperationReleaseInput } from '../src/live/live-operation-release-policy.ts'

function input(): LiveOperationReleaseInput {
  return {
    operation: 'PLACE', exchange: 'BITGET', accountRefHash: 'a'.repeat(64),
    productId: 'BTC-USDT', evaluatedAt: '2026-10-04T10:00:00.000Z', orderNotional: '100',
    runtime: {
      artifact: 'live-execution', network: 'mainnet', withdrawalsEnabled: false,
      releaseId: 'release-1', gitSha: 'b'.repeat(40), workerDeploymentId: 'worker-1',
      frontendDeploymentId: 'frontend-1', schemaVersion: '034',
    },
    release: {
      releaseId: 'release-1', gitSha: 'b'.repeat(40), workerDeploymentId: 'worker-1',
      frontendDeploymentId: 'frontend-1', schemaVersion: '034', exchange: 'BITGET',
      accountRefHash: 'a'.repeat(64), allowedProducts: ['BTC-USDT'],
      maxOrderNotional: '100', maxDailyNotional: '1000',
      startsAt: '2026-10-04T09:00:00.000Z', expiresAt: '2026-10-04T11:00:00.000Z',
      status: 'ACTIVE', securityReviewRef: 'security-1', complianceReviewRef: 'compliance-1',
    },
    dailyExposure: {accountRefHash: 'a'.repeat(64), exchange: 'BITGET', utcDay: '2026-10-04', usedAndReservedNotional: '900'},
  }
}

test('exact boundary satisfies scope but confers no execution capability', () => {
  const report = evaluateLiveOperationRelease(input())
  assert.equal(report.releaseScopeSatisfied, true)
  assert.equal(report.executionAllowed, false)
  assert.equal(report.withdrawalsAllowed, false)
  assert.ok(Object.isFrozen(report.checks))
})

test('release cannot authorize a different account, source, deployed artifact, schema, product or exchange', () => {
  for (const key of ['releaseId', 'gitSha', 'workerDeploymentId', 'frontendDeploymentId', 'schemaVersion', 'exchange', 'accountRefHash'] as const) {
    const value = input()
    value.release = {...value.release!, [key]: 'different'}
    assert.equal(evaluateLiveOperationRelease(value).releaseScopeSatisfied, false, key)
  }
  const value = input()
  value.productId = 'ETH-USDT'
  assert.equal(evaluateLiveOperationRelease(value).checks.product_allowed, false)
})

test('exact decimals detect smallest overspend without floating point rounding', () => {
  const value = input()
  value.orderNotional = '100.000000000000000001'
  const report = evaluateLiveOperationRelease(value)
  assert.equal(report.checks.order_limit_satisfied, false)
  assert.equal(report.checks.daily_limit_satisfied, false)
})

test('missing, wrong-account and previous-day daily exposure cannot admit place', () => {
  for (const exposure of [null, {...input().dailyExposure!, accountRefHash: 'c'.repeat(64)},
    {...input().dailyExposure!, exchange: 'BTCC'}, {...input().dailyExposure!, utcDay: '2026-10-03'}]) {
    const value = input()
    value.dailyExposure = exposure
    assert.equal(evaluateLiveOperationRelease(value).checks.daily_exposure_bound, false)
  }
})

test('malformed and inconsistent financial limits fail closed', () => {
  for (const bad of ['-1', 'NaN', '1e2', '', '0']) {
    const value = input()
    value.release = {...value.release!, maxOrderNotional: bad}
    assert.equal(evaluateLiveOperationRelease(value).checks.release_limits_valid, false, bad)
  }
  const value = input()
  value.release = {...value.release!, maxDailyNotional: '99'}
  assert.equal(evaluateLiveOperationRelease(value).releaseScopeSatisfied, false)
})

test('revocation, expiry boundary, future and noncanonical time are rejected', () => {
  for (const changed of [{status: 'REVOKED'}, {expiresAt: input().evaluatedAt},
    {startsAt: '2026-10-04T10:00:01.000Z'}, {startsAt: '2026-10-04T09:00:00Z'}]) {
    const value = input()
    value.release = {...value.release!, ...changed}
    assert.equal(evaluateLiveOperationRelease(value).releaseScopeSatisfied, false)
  }
  const value = input()
  value.evaluatedAt = 'invalid'
  assert.equal(evaluateLiveOperationRelease(value).checks.release_window_valid, false)
})

test('cancel does not allocate capital but still requires current release scope', () => {
  const value = input()
  value.operation = 'CANCEL'; value.orderNotional = null; value.dailyExposure = null
  assert.equal(evaluateLiveOperationRelease(value).releaseScopeSatisfied, true)
  value.release = {...value.release!, status: 'REVOKED'}
  assert.equal(evaluateLiveOperationRelease(value).releaseScopeSatisfied, false)
  value.orderNotional = '100'
  assert.equal(evaluateLiveOperationRelease(value).checks.operation_notional_valid, false)
})

test('candidate artifact or enabled withdrawals cannot satisfy live release scope', () => {
  for (const changed of [{artifact: 'live-candidate'}, {network: 'testnet'}, {withdrawalsEnabled: true}]) {
    const value = input()
    value.runtime = {...value.runtime, ...changed} as LiveOperationReleaseInput['runtime']
    assert.equal(evaluateLiveOperationRelease(value).releaseScopeSatisfied, false)
  }
})
