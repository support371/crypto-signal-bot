import assert from 'node:assert/strict'
import test from 'node:test'

import { buildAuditEvent, verifyAuditChain } from '../src/live/audit-chain.ts'

test('audit events form a deterministic hash chain', async () => {
  const first = await buildAuditEvent({
    eventId: 'audit-1',
    exchangeAccountId: 'account-ref-hash',
    actorId: 'operator-123',
    actorRole: 'risk_operator',
    action: 'ORDER_VALIDATED',
    resourceType: 'ORDER',
    resourceId: 'order-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'order:audit:0001',
    configurationVersion: 'config-v1',
    releaseId: null,
    outcome: 'ALLOWED',
    before: { state: 'REQUESTED' },
    after: { productId: 'BTC-USD', state: 'VALIDATED' },
    occurredAt: '2026-07-17T10:00:00.000Z',
  })
  const second = await buildAuditEvent({
    eventId: 'audit-2',
    exchangeAccountId: 'account-ref-hash',
    actorId: 'operator-123',
    actorRole: 'risk_operator',
    action: 'RISK_REJECTED',
    resourceType: 'ORDER',
    resourceId: 'order-1',
    correlationId: 'correlation-1',
    idempotencyKey: 'order:audit:0001',
    configurationVersion: 'config-v1',
    releaseId: null,
    outcome: 'BLOCKED',
    before: { state: 'VALIDATED' },
    after: { reason: 'execution_locked', state: 'RISK_REJECTED' },
    occurredAt: '2026-07-17T10:00:01.000Z',
  }, first.eventHash)

  assert.match(first.eventHash, /^[a-f0-9]{64}$/)
  assert.equal(second.previousEventHash, first.eventHash)
  assert.deepEqual(await verifyAuditChain([first, second]), {
    valid: true,
    invalidEventId: null,
  })
})

test('audit verification detects payload tampering', async () => {
  const event = await buildAuditEvent({
    eventId: 'audit-3',
    exchangeAccountId: 'account-ref-hash',
    actorId: null,
    actorRole: 'system',
    action: 'GUARDIAN_HALTED',
    resourceType: 'GUARDIAN',
    resourceId: 'account-ref-hash',
    correlationId: 'correlation-2',
    idempotencyKey: null,
    configurationVersion: 'config-v1',
    releaseId: null,
    outcome: 'BLOCKED',
    before: { halted: false },
    after: { halted: true, reason: 'reconciliation_drift' },
    occurredAt: '2026-07-17T10:05:00.000Z',
  })

  const tampered = {
    ...event,
    action: 'GUARDIAN_RESET',
  }
  assert.deepEqual(await verifyAuditChain([tampered]), {
    valid: false,
    invalidEventId: 'audit-3',
  })
})
