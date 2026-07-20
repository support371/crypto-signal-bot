import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decideCandidateProjectionRetry,
  projectionRetryDelayMs,
} from '../src/live/candidate-projection-retry.ts'

test('projection retry delay doubles and remains capped', () => {
  assert.equal(projectionRetryDelayMs(1), 30_000)
  assert.equal(projectionRetryDelayMs(2), 60_000)
  assert.equal(projectionRetryDelayMs(3), 120_000)
  assert.equal(projectionRetryDelayMs(20), 3_600_000)
})

test('non-conflict failures remain pending until the final attempt', () => {
  const now = new Date('2026-07-17T20:00:00.000Z')
  const first = decideCandidateProjectionRetry(0, false, now)
  assert.deepEqual(first, {
    nextStatus: 'PENDING',
    attemptCount: 1,
    nextAttemptAt: '2026-07-17T20:00:30.000Z',
    terminal: false,
  })

  const final = decideCandidateProjectionRetry(7, false, now)
  assert.deepEqual(final, {
    nextStatus: 'DEAD_LETTER',
    attemptCount: 8,
    nextAttemptAt: null,
    terminal: true,
  })
})

test('projection conflicts are quarantined immediately', () => {
  const decision = decideCandidateProjectionRetry(
    0,
    true,
    new Date('2026-07-17T20:00:00.000Z'),
  )
  assert.deepEqual(decision, {
    nextStatus: 'CONFLICT',
    attemptCount: 1,
    nextAttemptAt: null,
    terminal: true,
  })
})

test('invalid retry inputs fail closed', () => {
  assert.throws(
    () => projectionRetryDelayMs(0),
    /attemptCount must be a positive safe integer/,
  )
  assert.throws(
    () => decideCandidateProjectionRetry(-1, false, new Date()),
    /previousAttemptCount must be a non-negative safe integer/,
  )
  assert.throws(
    () => decideCandidateProjectionRetry(0, false, new Date('invalid')),
    /now must be valid/,
  )
})
