import { canonicalJson } from './canonical-json.ts'

export type LiveRole =
  | 'VIEWER'
  | 'TRADER'
  | 'RISK_OPERATOR'
  | 'RISK_ADMIN'
  | 'WITHDRAWAL_REQUESTER'
  | 'WITHDRAWAL_APPROVER'
  | 'AUDITOR'
  | 'RELEASE_ADMIN'

export type AuthorizationAction =
  | 'READ_ACCOUNT'
  | 'PREVIEW_ORDER'
  | 'CREATE_ORDER'
  | 'CANCEL_ORDER'
  | 'RUN_RECONCILIATION'
  | 'GUARDIAN_HALT'
  | 'GUARDIAN_RESET_REQUEST'
  | 'GUARDIAN_RESET_APPROVE'
  | 'REQUEST_WITHDRAWAL'
  | 'APPROVE_WITHDRAWAL'
  | 'AUTHORIZE_RELEASE'
  | 'EXPORT_AUDIT'
  | 'UPDATE_RISK_CONFIG'

export interface ScopedRole {
  role: LiveRole
  scopeType: 'GLOBAL' | 'EXCHANGE' | 'ACCOUNT'
  scopeKey: string
  expiresAt: string | null
  revokedAt: string | null
}

export interface StepUpSession {
  stepUpSessionId: string
  actorId: string
  assuranceLevel: 'AAL2' | 'AAL3'
  audience: string
  issuedAt: string
  expiresAt: string
  revokedAt: string | null
}

export interface AuthorizationRequest {
  actorId: string
  action: AuthorizationAction
  resourceType: string
  resourceId: string
  exchangeName: string | null
  exchangeAccountId: string | null
  resourceOwnerActorId: string | null
  roles: readonly ScopedRole[]
  stepUpSession: StepUpSession | null
  evaluatedAt: string
}

export interface AuthorizationDecision {
  allowed: boolean
  requiredRoles: readonly LiveRole[]
  matchedRoles: readonly LiveRole[]
  stepUpRequired: boolean
  separationRequired: boolean
  reasons: readonly string[]
}

export interface AuthorizationEnv {
  DB: D1Database
}

interface ActionPolicy {
  anyRole: readonly LiveRole[]
  stepUpRequired: boolean
  separationRequired: boolean
  stepUpAudience: string | null
}

const POLICIES: Readonly<Record<AuthorizationAction, ActionPolicy>> = {
  READ_ACCOUNT: {
    anyRole: ['VIEWER', 'TRADER', 'RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN'],
    stepUpRequired: false,
    separationRequired: false,
    stepUpAudience: null,
  },
  PREVIEW_ORDER: {
    anyRole: ['TRADER', 'RISK_OPERATOR', 'RISK_ADMIN'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'trading',
  },
  CREATE_ORDER: {
    anyRole: ['TRADER'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'trading',
  },
  CANCEL_ORDER: {
    anyRole: ['TRADER', 'RISK_OPERATOR', 'RISK_ADMIN'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'trading',
  },
  RUN_RECONCILIATION: {
    anyRole: ['RISK_OPERATOR', 'RISK_ADMIN', 'AUDITOR'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'operations',
  },
  GUARDIAN_HALT: {
    anyRole: ['RISK_OPERATOR', 'RISK_ADMIN'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'risk',
  },
  GUARDIAN_RESET_REQUEST: {
    anyRole: ['RISK_ADMIN'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'risk',
  },
  GUARDIAN_RESET_APPROVE: {
    anyRole: ['RISK_ADMIN', 'RELEASE_ADMIN'],
    stepUpRequired: true,
    separationRequired: true,
    stepUpAudience: 'risk',
  },
  REQUEST_WITHDRAWAL: {
    anyRole: ['WITHDRAWAL_REQUESTER'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'withdrawals',
  },
  APPROVE_WITHDRAWAL: {
    anyRole: ['WITHDRAWAL_APPROVER'],
    stepUpRequired: true,
    separationRequired: true,
    stepUpAudience: 'withdrawals',
  },
  AUTHORIZE_RELEASE: {
    anyRole: ['RELEASE_ADMIN'],
    stepUpRequired: true,
    separationRequired: true,
    stepUpAudience: 'release',
  },
  EXPORT_AUDIT: {
    anyRole: ['AUDITOR', 'RISK_ADMIN', 'RELEASE_ADMIN'],
    stepUpRequired: true,
    separationRequired: false,
    stepUpAudience: 'audit',
  },
  UPDATE_RISK_CONFIG: {
    anyRole: ['RISK_ADMIN'],
    stepUpRequired: true,
    separationRequired: true,
    stepUpAudience: 'risk',
  },
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function evaluatedTime(value: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError('evaluatedAt must be ISO-8601')
  return parsed
}

function roleInScope(
  role: ScopedRole,
  request: AuthorizationRequest,
  nowMs: number,
): boolean {
  if (role.revokedAt !== null) return false
  if (role.expiresAt !== null && Date.parse(role.expiresAt) <= nowMs) return false
  if (role.scopeType === 'GLOBAL') return true
  if (role.scopeType === 'EXCHANGE') return role.scopeKey === request.exchangeName
  return role.scopeKey === request.exchangeAccountId
}

function validStepUp(
  session: StepUpSession | null,
  request: AuthorizationRequest,
  policy: ActionPolicy,
  nowMs: number,
): boolean {
  if (!policy.stepUpRequired) return true
  if (!session) return false
  if (session.actorId !== request.actorId) return false
  if (session.revokedAt !== null) return false
  if (Date.parse(session.issuedAt) > nowMs || Date.parse(session.expiresAt) <= nowMs) return false
  if (!['AAL2', 'AAL3'].includes(session.assuranceLevel)) return false
  return policy.stepUpAudience === null || session.audience === policy.stepUpAudience
}

export function evaluateAuthorization(
  request: AuthorizationRequest,
): AuthorizationDecision {
  required(request.actorId, 'actorId')
  required(request.resourceType, 'resourceType')
  required(request.resourceId, 'resourceId')
  const nowMs = evaluatedTime(request.evaluatedAt)
  const policy = POLICIES[request.action]
  const activeRoles = request.roles
    .filter((role) => roleInScope(role, request, nowMs))
    .map((role) => role.role)
  const matchedRoles = Array.from(new Set(
    activeRoles.filter((role) => policy.anyRole.includes(role)),
  ))
  const reasons: string[] = []

  if (matchedRoles.length === 0) reasons.push('required_role_missing')
  if (!validStepUp(request.stepUpSession, request, policy, nowMs)) {
    reasons.push('valid_step_up_session_missing')
  }
  if (
    policy.separationRequired
    && request.resourceOwnerActorId !== null
    && request.resourceOwnerActorId === request.actorId
  ) {
    reasons.push('separation_of_duties_violation')
  }

  return {
    allowed: reasons.length === 0,
    requiredRoles: policy.anyRole,
    matchedRoles,
    stepUpRequired: policy.stepUpRequired,
    separationRequired: policy.separationRequired,
    reasons,
  }
}

export async function recordAuthorizationDecision(
  env: AuthorizationEnv,
  input: {
    authorizationEventId: string
    request: AuthorizationRequest
    decision: AuthorizationDecision
    correlationId: string
    auditEventHash: string
  },
): Promise<void> {
  const hash = input.auditEventHash.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new TypeError('auditEventHash must be a lowercase SHA-256 hash')
  }

  await env.DB.prepare(
    `INSERT INTO live_authorization_events (
       authorization_event_id, actor_id, action, resource_type, resource_id,
       required_roles_json, actor_roles_json, step_up_required,
       step_up_session_id, decision, reason, correlation_id,
       audit_event_hash, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    required(input.authorizationEventId, 'authorizationEventId'),
    input.request.actorId,
    input.request.action,
    input.request.resourceType,
    input.request.resourceId,
    canonicalJson(input.decision.requiredRoles),
    canonicalJson(input.decision.matchedRoles),
    input.decision.stepUpRequired ? 1 : 0,
    input.request.stepUpSession?.stepUpSessionId ?? null,
    input.decision.allowed ? 'ALLOW' : 'DENY',
    input.decision.reasons.join(',') || null,
    required(input.correlationId, 'correlationId'),
    hash,
    new Date(input.request.evaluatedAt).toISOString(),
  ).run()
}
