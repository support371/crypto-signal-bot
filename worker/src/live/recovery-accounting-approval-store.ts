import { canonicalJson } from './canonical-json.ts'
import type { AuthorizationDecision } from './authorization.ts'
import {
  evaluateVerifiedRecoveryAccountingApproval,
  type VerifiedRecoveryAccountingApprovalDecision,
} from './recovery-accounting-approval-service.ts'
import type { RecoveryAccountingApprovalInput } from './recovery-accounting-approval.ts'

export interface RecoveryAccountingApprovalStoreEnv {
  DB: D1Database
}

export interface PersistRecoveryAccountingApprovalResult {
  status: 'PROJECTED' | 'REPLAYED'
  planId: string
  planHash: string
  approvalEventId: string
  authorizationEventId: string
  approved: boolean
  approvalHash: string
  planIntegrityVerified: true
  automaticallyDispatched: false
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export class RecoveryAccountingApprovalConflictError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_APPROVAL_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingApprovalConflictError'
  }
}

type PlanRow = {
  plan_id: string
  plan_hash: string
  recovery_snapshot_hash: string
  exchange_account_id: string
  product_id: string
  command_count: number
  commands_json: string
  prepared_by_actor_id: string
  accounting_evidence_ready: number
  automatically_dispatched: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

type ApprovalRow = {
  approval_event_id: string
  authorization_event_id: string
  plan_id: string
  plan_hash: string
  actor_id: string
  plan_prepared_by_actor_id: string
  decision: 'APPROVED' | 'DENIED'
  reasons_json: string
  authorization_allowed: number
  matched_roles_json: string
  step_up_session_id: string | null
  approval_hash: string
  automatically_dispatched: number
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
  occurred_at: string
}

type AuthorizationRow = {
  authorization_event_id: string
  actor_id: string
  action: string
  resource_type: string
  resource_id: string
  required_roles_json: string
  actor_roles_json: string
  step_up_required: number
  step_up_session_id: string | null
  decision: 'ALLOW' | 'DENY'
  reason: string | null
  correlation_id: string
  audit_event_hash: string
  occurred_at: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function sha256(value: string, field: string): string {
  const normalized = required(value, field).toLowerCase()
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

function assertZeroCapabilities(
  row: {
    automatically_dispatched: number
    provider_mutation_allowed: number
    reservation_applied: number
    execution_allowed: number
  },
  field: string,
): void {
  if (
    row.automatically_dispatched !== 0
    || row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new RecoveryAccountingApprovalConflictError(
      `${field} violates the permanent capability locks`,
    )
  }
}

function expectedDecision(
  decision: VerifiedRecoveryAccountingApprovalDecision,
): 'APPROVED' | 'DENIED' {
  return decision.approved ? 'APPROVED' : 'DENIED'
}

function expectedAuthorizationDecision(decision: AuthorizationDecision): 'ALLOW' | 'DENY' {
  return decision.allowed ? 'ALLOW' : 'DENY'
}

function expectedAuthorizationReason(decision: AuthorizationDecision): string | null {
  return decision.reasons.join(',') || null
}

function assertPlanCompatible(
  row: PlanRow,
  input: RecoveryAccountingApprovalInput,
): void {
  assertZeroCapabilities(row, 'stored recovery accounting plan')
  if (
    row.plan_id !== input.planId
    || row.plan_hash !== input.plan.planHash
    || row.recovery_snapshot_hash !== input.plan.recoverySnapshotHash
    || row.exchange_account_id !== input.plan.exchangeAccountId
    || row.product_id !== input.plan.productId
    || row.command_count !== input.plan.commandCount
    || row.commands_json !== canonicalJson(input.plan.commands)
    || row.prepared_by_actor_id !== input.planPreparedByActorId
    || row.accounting_evidence_ready !== 1
  ) {
    throw new RecoveryAccountingApprovalConflictError(
      'stored recovery accounting plan conflicts with approval evidence',
    )
  }
}

function assertApprovalCompatible(
  row: ApprovalRow,
  input: RecoveryAccountingApprovalInput,
  decision: VerifiedRecoveryAccountingApprovalDecision,
): void {
  assertZeroCapabilities(row, 'stored recovery accounting approval')
  if (
    row.approval_event_id !== input.approvalEventId
    || row.authorization_event_id !== input.authorizationEventId
    || row.plan_id !== input.planId
    || row.plan_hash !== input.plan.planHash
    || row.actor_id !== input.actorId
    || row.plan_prepared_by_actor_id !== input.planPreparedByActorId
    || row.decision !== expectedDecision(decision)
    || row.reasons_json !== canonicalJson(decision.reasons)
    || row.authorization_allowed !== (decision.authorizationDecision.allowed ? 1 : 0)
    || row.matched_roles_json !== canonicalJson(decision.authorizationDecision.matchedRoles)
    || row.step_up_session_id !== input.stepUpSession?.stepUpSessionId
    || row.approval_hash !== decision.approvalHash
    || row.occurred_at !== decision.authorizationRequest.evaluatedAt
  ) {
    throw new RecoveryAccountingApprovalConflictError(
      'stored recovery accounting approval conflicts with evaluated evidence',
    )
  }
}

function assertAuthorizationCompatible(
  row: AuthorizationRow,
  input: RecoveryAccountingApprovalInput,
  decision: VerifiedRecoveryAccountingApprovalDecision,
): void {
  const authorization = decision.authorizationDecision
  const request = decision.authorizationRequest
  if (
    row.authorization_event_id !== input.authorizationEventId
    || row.actor_id !== request.actorId
    || row.action !== request.action
    || row.resource_type !== request.resourceType
    || row.resource_id !== request.resourceId
    || row.required_roles_json !== canonicalJson(authorization.requiredRoles)
    || row.actor_roles_json !== canonicalJson(authorization.matchedRoles)
    || row.step_up_required !== (authorization.stepUpRequired ? 1 : 0)
    || row.step_up_session_id !== request.stepUpSession?.stepUpSessionId
    || row.decision !== expectedAuthorizationDecision(authorization)
    || row.reason !== expectedAuthorizationReason(authorization)
    || row.correlation_id !== input.correlationId
    || row.audit_event_hash !== sha256(input.auditEventHash, 'auditEventHash')
    || row.occurred_at !== request.evaluatedAt
  ) {
    throw new RecoveryAccountingApprovalConflictError(
      'stored authorization event conflicts with recovery approval evidence',
    )
  }
}

async function loadPlan(
  env: RecoveryAccountingApprovalStoreEnv,
  input: RecoveryAccountingApprovalInput,
): Promise<PlanRow | null> {
  return env.DB.prepare(`
    SELECT plan_id, plan_hash, recovery_snapshot_hash, exchange_account_id,
           product_id, command_count, commands_json, prepared_by_actor_id,
           accounting_evidence_ready, automatically_dispatched,
           provider_mutation_allowed, reservation_applied, execution_allowed
      FROM live_recovery_accounting_plans
     WHERE plan_id = ? OR plan_hash = ?
     LIMIT 1
  `).bind(input.planId, input.plan.planHash).first<PlanRow>()
}

async function loadApproval(
  env: RecoveryAccountingApprovalStoreEnv,
  input: RecoveryAccountingApprovalInput,
  approvalHash: string,
): Promise<ApprovalRow | null> {
  return env.DB.prepare(`
    SELECT approval_event_id, authorization_event_id, plan_id, plan_hash,
           actor_id, plan_prepared_by_actor_id, decision, reasons_json,
           authorization_allowed, matched_roles_json, step_up_session_id,
           approval_hash, automatically_dispatched, provider_mutation_allowed,
           reservation_applied, execution_allowed, occurred_at
      FROM live_recovery_accounting_approval_events
     WHERE approval_event_id = ? OR approval_hash = ?
     LIMIT 1
  `).bind(input.approvalEventId, approvalHash).first<ApprovalRow>()
}

async function loadAuthorization(
  env: RecoveryAccountingApprovalStoreEnv,
  authorizationEventId: string,
): Promise<AuthorizationRow | null> {
  return env.DB.prepare(`
    SELECT authorization_event_id, actor_id, action, resource_type,
           resource_id, required_roles_json, actor_roles_json,
           step_up_required, step_up_session_id, decision, reason,
           correlation_id, audit_event_hash, occurred_at
      FROM live_authorization_events
     WHERE authorization_event_id = ?
     LIMIT 1
  `).bind(authorizationEventId).first<AuthorizationRow>()
}

function result(
  status: PersistRecoveryAccountingApprovalResult['status'],
  input: RecoveryAccountingApprovalInput,
  decision: VerifiedRecoveryAccountingApprovalDecision,
): PersistRecoveryAccountingApprovalResult {
  return Object.freeze({
    status,
    planId: input.planId,
    planHash: input.plan.planHash,
    approvalEventId: input.approvalEventId,
    authorizationEventId: input.authorizationEventId,
    approved: decision.approved,
    approvalHash: decision.approvalHash,
    planIntegrityVerified: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export async function persistRecoveryAccountingApproval(
  env: RecoveryAccountingApprovalStoreEnv,
  input: RecoveryAccountingApprovalInput,
): Promise<PersistRecoveryAccountingApprovalResult> {
  required(input.planId, 'planId')
  required(input.approvalEventId, 'approvalEventId')
  required(input.authorizationEventId, 'authorizationEventId')
  const decision = await evaluateVerifiedRecoveryAccountingApproval(input)

  const existingApproval = await loadApproval(env, input, decision.approvalHash)
  if (existingApproval) {
    assertApprovalCompatible(existingApproval, input, decision)
    const existingPlan = await loadPlan(env, input)
    const existingAuthorization = await loadAuthorization(env, input.authorizationEventId)
    if (!existingPlan || !existingAuthorization) {
      throw new RecoveryAccountingApprovalConflictError(
        'approval event exists without its immutable plan and authorization evidence',
      )
    }
    assertPlanCompatible(existingPlan, input)
    assertAuthorizationCompatible(existingAuthorization, input, decision)
    return result('REPLAYED', input, decision)
  }

  const existingPlan = await loadPlan(env, input)
  if (existingPlan) assertPlanCompatible(existingPlan, input)
  const existingAuthorization = await loadAuthorization(env, input.authorizationEventId)
  if (existingAuthorization) {
    assertAuthorizationCompatible(existingAuthorization, input, decision)
  }

  const statements: D1PreparedStatement[] = []
  if (!existingPlan) {
    statements.push(env.DB.prepare(`
      INSERT INTO live_recovery_accounting_plans (
        plan_id, exchange_name, exchange_account_id, product_id,
        recovery_snapshot_hash, plan_hash, command_count, commands_json,
        prepared_by_actor_id, accounting_evidence_ready,
        automatically_dispatched, provider_mutation_allowed,
        reservation_applied, execution_allowed
      ) VALUES (?, 'BITGET', ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, 0)
    `).bind(
      input.planId,
      input.plan.exchangeAccountId,
      input.plan.productId,
      input.plan.recoverySnapshotHash,
      input.plan.planHash,
      input.plan.commandCount,
      canonicalJson(input.plan.commands),
      input.planPreparedByActorId,
    ))
  }

  if (!existingAuthorization) {
    statements.push(env.DB.prepare(`
      INSERT INTO live_authorization_events (
        authorization_event_id, actor_id, action, resource_type, resource_id,
        required_roles_json, actor_roles_json, step_up_required,
        step_up_session_id, decision, reason, correlation_id,
        audit_event_hash, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.authorizationEventId,
      decision.authorizationRequest.actorId,
      decision.authorizationRequest.action,
      decision.authorizationRequest.resourceType,
      decision.authorizationRequest.resourceId,
      canonicalJson(decision.authorizationDecision.requiredRoles),
      canonicalJson(decision.authorizationDecision.matchedRoles),
      decision.authorizationDecision.stepUpRequired ? 1 : 0,
      decision.authorizationRequest.stepUpSession?.stepUpSessionId ?? null,
      expectedAuthorizationDecision(decision.authorizationDecision),
      expectedAuthorizationReason(decision.authorizationDecision),
      input.correlationId,
      sha256(input.auditEventHash, 'auditEventHash'),
      decision.authorizationRequest.evaluatedAt,
    ))
  }

  statements.push(env.DB.prepare(`
    INSERT INTO live_recovery_accounting_approval_events (
      approval_event_id, authorization_event_id, plan_id, plan_hash,
      actor_id, plan_prepared_by_actor_id, decision, reasons_json,
      authorization_allowed, matched_roles_json, step_up_session_id,
      approval_hash, automatically_dispatched, provider_mutation_allowed,
      reservation_applied, execution_allowed, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
  `).bind(
    input.approvalEventId,
    input.authorizationEventId,
    input.planId,
    input.plan.planHash,
    input.actorId,
    input.planPreparedByActorId,
    expectedDecision(decision),
    canonicalJson(decision.reasons),
    decision.authorizationDecision.allowed ? 1 : 0,
    canonicalJson(decision.authorizationDecision.matchedRoles),
    input.stepUpSession?.stepUpSessionId ?? null,
    decision.approvalHash,
    decision.authorizationRequest.evaluatedAt,
  ))

  await env.DB.batch(statements)

  const projectedPlan = await loadPlan(env, input)
  const projectedAuthorization = await loadAuthorization(env, input.authorizationEventId)
  const projectedApproval = await loadApproval(env, input, decision.approvalHash)
  if (!projectedPlan || !projectedAuthorization || !projectedApproval) {
    throw new Error('recovery accounting approval evidence is missing after D1 batch')
  }
  assertPlanCompatible(projectedPlan, input)
  assertAuthorizationCompatible(projectedAuthorization, input, decision)
  assertApprovalCompatible(projectedApproval, input, decision)
  return result('PROJECTED', input, decision)
}
