import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateAuthorization,
  type AuthorizationRequest,
  type ScopedRole,
  type StepUpSession,
} from '../src/live/authorization.ts'

const evaluatedAt = '2026-07-17T20:00:00.000Z'

function role(
  value: ScopedRole['role'],
  scopeType: ScopedRole['scopeType'] = 'ACCOUNT',
  scopeKey = 'bitget-account-ref',
): ScopedRole {
  return {
    role: value,
    scopeType,
    scopeKey,
    expiresAt: null,
    revokedAt: null,
  }
}

function stepUp(actorId: string, audience = 'operations'): StepUpSession {
  return {
    stepUpSessionId: `step-up-${actorId}-${audience}`,
    actorId,
    assuranceLevel: 'AAL2',
    audience,
    issuedAt: '2026-07-17T19:55:00.000Z',
    expiresAt: '2026-07-17T20:05:00.000Z',
    revokedAt: null,
  }
}

function request(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    actorId: 'risk-operator-1',
    action: 'ACKNOWLEDGE_ALERT',
    resourceType: 'OPERATIONAL_ALERT',
    resourceId: 'projection-alert-1',
    exchangeName: 'BITGET',
    exchangeAccountId: 'bitget-account-ref',
    resourceOwnerActorId: null,
    roles: [role('RISK_OPERATOR')],
    stepUpSession: stepUp('risk-operator-1'),
    evaluatedAt,
    ...overrides,
  }
}

test('scoped risk operator with operations step-up may acknowledge projection alert', () => {
  const decision = evaluateAuthorization(request())

  assert.equal(decision.allowed, true)
  assert.deepEqual(decision.requiredRoles, ['RISK_OPERATOR', 'RISK_ADMIN'])
  assert.deepEqual(decision.matchedRoles, ['RISK_OPERATOR'])
  assert.equal(decision.stepUpRequired, true)
  assert.equal(decision.separationRequired, false)
})

test('risk admin may acknowledge with valid account scope and operations step-up', () => {
  const decision = evaluateAuthorization(request({
    roles: [role('RISK_ADMIN')],
  }))

  assert.equal(decision.allowed, true)
  assert.deepEqual(decision.matchedRoles, ['RISK_ADMIN'])
})

test('viewer and auditor roles cannot acknowledge operational alerts', () => {
  for (const value of ['VIEWER', 'AUDITOR'] as const) {
    const decision = evaluateAuthorization(request({ roles: [role(value)] }))
    assert.equal(decision.allowed, false)
    assert.ok(decision.reasons.includes('required_role_missing'))
  }
})

test('wrong account scope fails closed', () => {
  const decision = evaluateAuthorization(request({
    roles: [role('RISK_OPERATOR', 'ACCOUNT', 'other-account')],
  }))

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('required_role_missing'))
})

test('missing or wrong-audience step-up session fails closed', () => {
  const missing = evaluateAuthorization(request({ stepUpSession: null }))
  const wrongAudience = evaluateAuthorization(request({
    stepUpSession: stepUp('risk-operator-1', 'risk'),
  }))

  assert.equal(missing.allowed, false)
  assert.ok(missing.reasons.includes('valid_step_up_session_missing'))
  assert.equal(wrongAudience.allowed, false)
  assert.ok(wrongAudience.reasons.includes('valid_step_up_session_missing'))
})

test('alert acknowledgment policy never grants trading actions', () => {
  const acknowledge = evaluateAuthorization(request())
  const createOrder = evaluateAuthorization(request({ action: 'CREATE_ORDER' }))

  assert.equal(acknowledge.allowed, true)
  assert.equal(createOrder.allowed, false)
  assert.ok(createOrder.reasons.includes('required_role_missing'))
})
