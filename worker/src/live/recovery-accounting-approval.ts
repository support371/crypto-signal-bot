import { canonicalHash } from './canonical-json.ts'
import {
  evaluateAuthorization,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type ScopedRole,
  type StepUpSession,
} from './authorization.ts'
import type { BitgetRecoveryAccountingPlan } from './bitget-recovery-accounting-plan.ts'

export interface RecoveryAccountingApprovalInput {
  approvalEventId: string
  authorizationEventId: string
  planId: string
  plan: BitgetRecoveryAccountingPlan
  planPreparedByActorId: string
  actorId: string
  roles: readonly ScopedRole[]
  stepUpSession: StepUpSession | null
  correlationId: string
  auditEventHash: string
  evaluatedAt: string
}

export interface RecoveryAccountingApprovalDecision {
  planId: string
  planHash: string
  approved: boolean
  reasons: readonly string[]
  authorizationRequest: AuthorizationRequest
  authorizationDecision: AuthorizationDecision
  approvalHash: string
  automaticallyDispatched: false
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

const RISK_APPROVAL_ROLES = new Set(['RISK_OPERATOR', 'RISK_ADMIN'])

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function assertPlanBoundary(plan: BitgetRecoveryAccountingPlan): void {
  if (
    plan.exchangeName !== 'BITGET'
    || plan.accountingEvidenceReady !== true
    || plan.automaticallyDispatched !== false
    || plan.providerMutationAllowed !== false
    || plan.reservationApplied !== false
    || plan.executionAllowed !== false
  ) {
    throw new TypeError('recovery accounting plan violates the non-execution boundary')
  }
  if (plan.commandCount !== plan.commands.length) {
    throw new TypeError('recovery accounting plan command count is inconsistent')
  }
  sha256(plan.planHash, 'plan.planHash')
  sha256(plan.recoverySnapshotHash, 'plan.recoverySnapshotHash')

  for (const command of plan.commands) {
    if (
      command.exchangeName !== 'BITGET'
      || command.exchangeAccountId !== plan.exchangeAccountId
      || command.fill.productId !== plan.productId
    ) {
      throw new TypeError('recovery accounting command does not match the plan scope')
    }
  }
}

function approvalAuthorizationRequest(
  input: RecoveryAccountingApprovalInput,
  evaluatedAt: string,
): AuthorizationRequest {
  return {
    actorId: required(input.actorId, 'actorId'),
    action: 'RUN_RECONCILIATION',
    resourceType: 'RECOVERY_ACCOUNTING_PLAN',
    resourceId: required(input.planId, 'planId'),
    exchangeName: 'BITGET',
    exchangeAccountId: required(input.plan.exchangeAccountId, 'plan.exchangeAccountId'),
    resourceOwnerActorId: required(input.planPreparedByActorId, 'planPreparedByActorId'),
    roles: input.roles,
    stepUpSession: input.stepUpSession,
    evaluatedAt,
  }
}

export async function evaluateRecoveryAccountingApproval(
  input: RecoveryAccountingApprovalInput,
): Promise<RecoveryAccountingApprovalDecision> {
  required(input.approvalEventId, 'approvalEventId')
  required(input.authorizationEventId, 'authorizationEventId')
  required(input.correlationId, 'correlationId')
  sha256(input.auditEventHash, 'auditEventHash')
  assertPlanBoundary(input.plan)
  const evaluatedAt = iso(input.evaluatedAt, 'evaluatedAt')
  const authorizationRequest = approvalAuthorizationRequest(input, evaluatedAt)
  const authorizationDecision = evaluateAuthorization(authorizationRequest)
  const reasons = new Set<string>(authorizationDecision.reasons)

  const matchedRiskRole = authorizationDecision.matchedRoles.some((role) => (
    RISK_APPROVAL_ROLES.has(role)
  ))
  if (!matchedRiskRole) reasons.add('risk_approval_role_required')
  if (authorizationRequest.actorId === authorizationRequest.resourceOwnerActorId) {
    reasons.add('plan_preparer_cannot_approve')
  }

  const normalizedReasons = Object.freeze(Array.from(reasons).sort())
  const approved = authorizationDecision.allowed
    && matchedRiskRole
    && !normalizedReasons.includes('plan_preparer_cannot_approve')
  const approvalHash = await canonicalHash({
    approvalEventId: input.approvalEventId,
    authorizationEventId: input.authorizationEventId,
    planId: input.planId,
    planHash: input.plan.planHash,
    recoverySnapshotHash: input.plan.recoverySnapshotHash,
    actorId: authorizationRequest.actorId,
    planPreparedByActorId: authorizationRequest.resourceOwnerActorId,
    approved,
    reasons: normalizedReasons,
    authorizationDecision,
    evaluatedAt,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })

  return Object.freeze({
    planId: input.planId,
    planHash: input.plan.planHash,
    approved,
    reasons: normalizedReasons,
    authorizationRequest,
    authorizationDecision,
    approvalHash,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}
