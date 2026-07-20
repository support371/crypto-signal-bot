import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OPERATIONAL_REHEARSAL_SCENARIOS,
  evaluateOperationalRehearsal,
  type OperationalRehearsalInput,
  type OperationalScenarioInput,
} from '../src/live/demo-operational-rehearsal.ts'

const zeroLocks = Object.freeze({
  deploymentAllowed: false as const,
  demoRequestAllowed: false as const,
  credentialsRead: false as const,
  credentialsPersisted: false as const,
  providerMutationAllowed: false as const,
  executionAllowed: false as const,
  liveExecutionAllowed: false as const,
  realFundsAllowed: false as const,
  mainnetAllowed: false as const,
  withdrawalsAllowed: false as const,
  automaticRetryAllowed: false as const,
  accountingAutomaticallyDispatched: false as const,
})

function scenario(overrides: Partial<OperationalScenarioInput> = {}): OperationalScenarioInput {
  return Object.freeze({
    passed: true,
    evidenceHash: 'a'.repeat(64),
    observedAt: '2026-07-19T18:00:00.000Z',
    ...zeroLocks,
    ...overrides,
  })
}

function input(): OperationalRehearsalInput {
  return {
    packId: 'operational-rehearsal-0001',
    gitSha: 'b'.repeat(40),
    scenarios: Object.freeze(Object.fromEntries(
      OPERATIONAL_REHEARSAL_SCENARIOS.map((name, index) => [
        name,
        scenario({ evidenceHash: (index + 1).toString(16).repeat(64) }),
      ]),
    )) as OperationalRehearsalInput['scenarios'],
    preparedBy: 'operations-reviewer-0001',
    preparedAt: '2026-07-19T18:01:00.000Z',
  }
}

test('complete rehearsal evidence is review-ready and remains non-live', async () => {
  const pack = await evaluateOperationalRehearsal(input())
  assert.equal(pack.status, 'READY_FOR_INDEPENDENT_REVIEW')
  assert.equal(pack.readyForIndependentReview, true)
  assert.equal(pack.passedCount, 5)
  assert.equal(pack.deploymentAllowed, false)
  assert.equal(pack.demoRequestAllowed, false)
  assert.equal(pack.executionAllowed, false)
  assert.equal(pack.liveExecutionAllowed, false)
  assert.equal(pack.realFundsAllowed, false)
  assert.equal(pack.mainnetAllowed, false)
  assert.equal(pack.withdrawalsAllowed, false)
  assert.equal(pack.automaticRetryAllowed, false)
})

test('failed and missing evidence remain blocked', async () => {
  const value = input()
  const scenarios = {
    ...value.scenarios,
    DISASTER_RECOVERY_RESTORE: scenario({ evidenceHash: null }),
    PROVIDER_OUTAGE_FAIL_CLOSED: scenario({ passed: false }),
  }
  const pack = await evaluateOperationalRehearsal({
    ...value,
    scenarios: Object.freeze(scenarios),
  })
  assert.equal(pack.status, 'BLOCKED')
  assert.equal(pack.readyForIndependentReview, false)
  assert.equal(pack.passedCount, 3)
  assert.equal(pack.blockers.length, 2)
})

test('unsafe capability evidence is rejected', async () => {
  const value = input()
  const scenarios = {
    ...value.scenarios,
    ROLLBACK_TO_KNOWN_GOOD: {
      ...scenario(),
      deploymentAllowed: true,
    } as unknown as OperationalScenarioInput,
  }
  await assert.rejects(
    evaluateOperationalRehearsal({ ...value, scenarios: Object.freeze(scenarios) }),
    /must remain non-live/,
  )
})
