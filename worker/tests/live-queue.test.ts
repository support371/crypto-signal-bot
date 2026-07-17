import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeQueueEnvelope,
  queueEnvelopeHash,
} from '../src/live/queue-contracts.ts'

const base = {
  eventId: 'queue-event-1',
  messageType: 'RECONCILE_ACCOUNT' as const,
  exchangeAccountId: 'account-ref-hash',
  correlationId: 'correlation-1',
  receivedAt: '2026-07-17T10:00:00.000Z',
  availableAt: '2026-07-17T10:00:00.000Z',
}

test('queue envelope hashes are canonical and payload-sensitive', async () => {
  const first = await queueEnvelopeHash({
    ...base,
    payload: { reason: 'startup', force: false },
  })
  const reordered = await queueEnvelopeHash({
    ...base,
    payload: { force: false, reason: 'startup' },
  })
  const changed = await queueEnvelopeHash({
    ...base,
    payload: { reason: 'startup', force: true },
  })

  assert.equal(first, reordered)
  assert.notEqual(first, changed)
  assert.match(first, /^[a-f0-9]{64}$/)
})

test('queue envelopes normalize identifiers and timestamps', () => {
  const normalized = normalizeQueueEnvelope({
    ...base,
    exchangeAccountId: ' account-ref-hash ',
    correlationId: ' correlation-1 ',
    payload: { reason: 'startup' },
    receivedAt: '2026-07-17T10:00:00Z',
    availableAt: '2026-07-17T10:00:05Z',
  })

  assert.equal(normalized.exchangeAccountId, 'account-ref-hash')
  assert.equal(normalized.correlationId, 'correlation-1')
  assert.equal(normalized.receivedAt, '2026-07-17T10:00:00.000Z')
  assert.equal(normalized.availableAt, '2026-07-17T10:00:05.000Z')
})

test('invalid queue messages fail closed before persistence', () => {
  assert.throws(
    () => normalizeQueueEnvelope({
      ...base,
      messageType: 'EXECUTE_ORDER' as never,
      payload: {},
    }),
    /unsupported messageType/,
  )
  assert.throws(
    () => normalizeQueueEnvelope({
      ...base,
      payload: {},
      availableAt: 'not-a-time',
    }),
    /availableAt must be ISO-8601/,
  )
})
