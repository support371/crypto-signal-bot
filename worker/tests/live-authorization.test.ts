import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateAuthorization,
  type AuthorizationRequest,
  type ScopedRole,
  type StepUpSession,
} from '../src/live/authorization.ts'

const evaluatedAt = '2026-07-17T10:00:00.000Z'

function role(
  value: ScopedRole['role'],
  scopeType: ScopedRole['scopeType'] = 'GLOBAL',
  scopeKey = 'global',
): ScopedRole {
  return {
    role: value,
    scopeType,
    scopeKey,
    expiresAt: null,
    revokedAt: null,
  }
}

function stepUp(
  actorId: string,
  audience: string,
): StepUpSession {
  return {
    stepUpSessionId: `step-up-${actorId}-${audience}`,
    actorId,
    assuranceLevel: 'AAL2',
    audience,
    issuedAt: '2026-07-17T09:55:00.000Z',
    expiresAt: '2026-07-17T10:05:00.000Z',
    revokedAt: null,
  }
}

function request(
  overrides: Partial<AuthorizationRequest>,
): AuthorizationRequest {
  return {
    actorId: 'actor-1',
    action: 'READ_ACCOUNT',
    resourceType: 'EXCHANGE_ACCOUNT',
    resourceId: 'account-1',
    exchangeName: 'coinbase',
    exchangeAccountId: 'account-1',
    resourceOwnerActorId: null,
    roles: [role('VIEWER')],
    stepUpSession: null,
    evaluatedAt,
    ...overrides,
  }
}

test('viewer can read but cannot create orders', () => {
  assert.equal(evaluateAuthorization(request({})).allowed, true)
  const create = evaluateAuthorization(request({
    action: 'CREATE_ORDER',
    roles: [role('VIEWER')],
    stepUpSession: stepUp('actor-1', 'trading'),
  }))
  assert.equal(create.allowed, false)
  assert.ok(create.reasons.includes('required_role_missing'))
})

test('trading actions require both scoped trader role and step-up session', () => {
  const noStepUp = evaluateAuthorization(request({
    action: 'CREATE_ORDER',
    roles: [role('TRADER', 'ACCOUNT', 'account-1')],
  }))
  const wrongScope = evaluateAuthorization(request({
    action: 'CREATE_ORDER',
    roles: [role('TRADER', 'ACCOUNT', 'account-2')],
    stepUpSession: stepUp('actor-1', 'trading'),
  }))
  const allowed = evaluateAuthorization(request({
    action: 'CREATE_ORDER',
    roles: [role('TRADER', 'ACCOUNT', 'account-1')],
    stepUpSession: stepUp('actor-1', 'trading'),
  }))

  assert.equal(noStepUp.allowed, false)
  assert.ok(noStepUp.reasons.includes('valid_step_up_session_missing'))
  assert.equal(wrongScope.allowed, false)
  assert.ok(wrongScope.reasons.includes('required_role_missing'))
  assert.equal(allowed.allowed, true)
})

test('withdrawal requester cannot approve their own withdrawal', () => {
  const decision = evaluateAuthorization(request({
    action: 'APPROVE_WITHDRAWAL',
    resourceType: 'WITHDRAWAL',
    resourceId: 'withdrawal-1',
    resourceOwnerActorId: 'actor-1',
    roles: [role('WITHDRAWAL_APPROVER', 'ACCOUNT', 'account-1')],
    stepUpSession: stepUp('actor-1', 'withdrawals'),
  }))

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('separation_of_duties_violation'))
})

test('distinct withdrawal approver with valid step-up is allowed by authorization policy', () => {
  const decision = evaluateAuthorization(request({
    actorId: 'actor-2',
    action: 'APPROVE_WITHDRAWAL',
    resourceType: 'WITHDRAWAL',
    resourceId: 'withdrawal-1',
    resourceOwnerActorId: 'actor-1',
    roles: [role('WITHDRAWAL_APPROVER', 'ACCOUNT', 'account-1')],
    stepUpSession: stepUp('actor-2', 'withdrawals'),
  }))

  assert.equal(decision.allowed, true)
  assert.deepEqual(decision.matchedRoles, ['WITHDRAWAL_APPROVER'])
})

test('expired roles and revoked step-up sessions fail closed', () => {
  const expiredRole: ScopedRole = {
    ...role('RISK_ADMIN'),
    expiresAt: '2026-07-17T09:59:00.000Z',
  }
  const revokedSession: StepUpSession = {
    ...stepUp('actor-1', 'risk'),
    revokedAt: '2026-07-17T09:59:30.000Z',
  }
  const decision = evaluateAuthorization(request({
    action: 'GUARDIAN_HALT',
    roles: [expiredRole],
    stepUpSession: revokedSession,
  }))

  assert.equal(decision.allowed, false)
  assert.ok(decision.reasons.includes('required_role_missing'))
  assert.ok(decision.reasons.includes('valid_step_up_session_missing'))
})
