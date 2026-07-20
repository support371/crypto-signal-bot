export type GuardianScopeType =
  | 'GLOBAL'
  | 'ENVIRONMENT'
  | 'EXCHANGE'
  | 'ACCOUNT'
  | 'STRATEGY'
  | 'SYMBOL'
  | 'ORDER_TYPE'
  | 'WITHDRAWALS'

export type GuardianStatus = 'CLEAR' | 'RESTRICTED' | 'HALTED'

export interface GuardianScopeState {
  scopeType: GuardianScopeType
  scopeKey: string
  status: GuardianStatus
  reasonCode: string | null
  reasonDetail: string | null
  version: number
  updatedAt: string
}

export interface EffectiveGuardianDecision {
  status: GuardianStatus
  blockedScopes: readonly GuardianScopeState[]
  restrictedScopes: readonly GuardianScopeState[]
  newOrdersAllowed: boolean
  cancelsAllowed: boolean
  closeOnlyAllowed: boolean
  withdrawalsAllowed: boolean
  reasons: readonly string[]
}

export interface GuardianEnv {
  DB: D1Database
}

const STATUS_PRIORITY: Readonly<Record<GuardianStatus, number>> = {
  CLEAR: 0,
  RESTRICTED: 1,
  HALTED: 2,
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function timestamp(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(value).toISOString()
}

function hash(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

export function evaluateGuardianHierarchy(
  states: readonly GuardianScopeState[],
): EffectiveGuardianDecision {
  const ordered = [...states].sort((left, right) => {
    const priority = STATUS_PRIORITY[right.status] - STATUS_PRIORITY[left.status]
    if (priority !== 0) return priority
    const scope = left.scopeType.localeCompare(right.scopeType)
    return scope !== 0 ? scope : left.scopeKey.localeCompare(right.scopeKey)
  })

  const blockedScopes = ordered.filter((state) => state.status === 'HALTED')
  const restrictedScopes = ordered.filter((state) => state.status === 'RESTRICTED')
  const status: GuardianStatus = blockedScopes.length > 0
    ? 'HALTED'
    : restrictedScopes.length > 0
      ? 'RESTRICTED'
      : 'CLEAR'
  const withdrawalBlocked = ordered.some(
    (state) => state.scopeType === 'WITHDRAWALS' && state.status !== 'CLEAR',
  )
  const globalOrAccountHalt = blockedScopes.some(
    (state) => ['GLOBAL', 'ENVIRONMENT', 'EXCHANGE', 'ACCOUNT'].includes(state.scopeType),
  )

  return {
    status,
    blockedScopes,
    restrictedScopes,
    newOrdersAllowed: status === 'CLEAR',
    cancelsAllowed: true,
    closeOnlyAllowed: !globalOrAccountHalt,
    withdrawalsAllowed: status === 'CLEAR' && !withdrawalBlocked,
    reasons: ordered
      .filter((state) => state.status !== 'CLEAR')
      .map((state) => `${state.scopeType}:${state.scopeKey}:${state.reasonCode ?? 'unspecified'}`),
  }
}

export async function setGuardianState(
  env: GuardianEnv,
  input: {
    eventId: string
    scopeType: GuardianScopeType
    scopeKey: string
    nextStatus: Exclude<GuardianStatus, 'CLEAR'>
    reasonCode: string
    reasonDetail?: string | null
    actorId: string
    correlationId: string
    auditEventHash: string
    occurredAt: string
    dualApprovalRequired?: boolean
  },
): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT status, version
       FROM live_guardian_states
      WHERE scope_type = ? AND scope_key = ?
      LIMIT 1`,
  ).bind(input.scopeType, input.scopeKey).first<{ status: GuardianStatus; version: number }>()
  const previousStatus = existing?.status ?? 'CLEAR'
  const nextVersion = Number(existing?.version ?? 0) + 1
  const occurredAt = timestamp(input.occurredAt, 'occurredAt')

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO live_guardian_states (
         scope_type, scope_key, status, reason_code, reason_detail,
         triggered_by, triggered_at, reset_requires_dual_approval, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(scope_type, scope_key) DO UPDATE SET
         status = excluded.status,
         reason_code = excluded.reason_code,
         reason_detail = excluded.reason_detail,
         triggered_by = excluded.triggered_by,
         triggered_at = excluded.triggered_at,
         reset_requires_dual_approval = excluded.reset_requires_dual_approval,
         version = excluded.version,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      input.scopeType,
      required(input.scopeKey, 'scopeKey'),
      input.nextStatus,
      required(input.reasonCode, 'reasonCode'),
      input.reasonDetail?.trim() || null,
      required(input.actorId, 'actorId'),
      occurredAt,
      input.dualApprovalRequired === false ? 0 : 1,
      nextVersion,
    ),
    env.DB.prepare(
      `INSERT INTO live_guardian_events (
         event_id, scope_type, scope_key, previous_status, next_status,
         reason_code, reason_detail, actor_id, correlation_id,
         audit_event_hash, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      required(input.eventId, 'eventId'),
      input.scopeType,
      required(input.scopeKey, 'scopeKey'),
      previousStatus,
      input.nextStatus,
      required(input.reasonCode, 'reasonCode'),
      input.reasonDetail?.trim() || null,
      required(input.actorId, 'actorId'),
      required(input.correlationId, 'correlationId'),
      hash(input.auditEventHash, 'auditEventHash'),
      occurredAt,
    ),
  ])
}

export async function createGuardianResetRequest(
  env: GuardianEnv,
  input: {
    resetRequestId: string
    scopeType: GuardianScopeType
    scopeKey: string
    requestedBy: string
    reason: string
    expectedGuardianVersion: number
    expiresAt: string
  },
): Promise<void> {
  if (!Number.isInteger(input.expectedGuardianVersion) || input.expectedGuardianVersion < 1) {
    throw new RangeError('expectedGuardianVersion must be a positive integer')
  }

  await env.DB.prepare(
    `INSERT INTO live_guardian_reset_requests (
       reset_request_id, scope_type, scope_key, requested_by, reason,
       expected_guardian_version, status, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
  ).bind(
    required(input.resetRequestId, 'resetRequestId'),
    input.scopeType,
    required(input.scopeKey, 'scopeKey'),
    required(input.requestedBy, 'requestedBy'),
    required(input.reason, 'reason'),
    input.expectedGuardianVersion,
    timestamp(input.expiresAt, 'expiresAt'),
  ).run()
}

export async function approveGuardianReset(
  env: GuardianEnv,
  input: {
    resetRequestId: string
    approverId: string
    approvalRole: 'RISK_ADMIN' | 'RELEASE_ADMIN'
    approvedAt: string
    auditEventHash: string
  },
): Promise<void> {
  const request = await env.DB.prepare(
    `SELECT requested_by, status, expires_at
       FROM live_guardian_reset_requests
      WHERE reset_request_id = ?
      LIMIT 1`,
  ).bind(input.resetRequestId).first<{
    requested_by: string
    status: string
    expires_at: string
  }>()
  if (!request || request.status !== 'PENDING') {
    throw new Error('guardian reset request is not pending')
  }
  if (Date.parse(request.expires_at) <= Date.parse(input.approvedAt)) {
    throw new Error('guardian reset request is expired')
  }
  if (request.requested_by === input.approverId) {
    throw new Error('guardian reset requester cannot self-approve')
  }

  await env.DB.prepare(
    `INSERT INTO live_guardian_reset_approvals (
       reset_request_id, approver_id, approval_role, approved_at, audit_event_hash
     ) VALUES (?, ?, ?, ?, ?)`,
  ).bind(
    required(input.resetRequestId, 'resetRequestId'),
    required(input.approverId, 'approverId'),
    input.approvalRole,
    timestamp(input.approvedAt, 'approvedAt'),
    hash(input.auditEventHash, 'auditEventHash'),
  ).run()
}

export async function applyGuardianReset(
  env: GuardianEnv,
  input: {
    resetRequestId: string
    eventId: string
    actorId: string
    correlationId: string
    auditEventHash: string
    occurredAt: string
  },
): Promise<void> {
  const request = await env.DB.prepare(
    `SELECT scope_type, scope_key, expected_guardian_version, status, expires_at
       FROM live_guardian_reset_requests
      WHERE reset_request_id = ?
      LIMIT 1`,
  ).bind(input.resetRequestId).first<{
    scope_type: GuardianScopeType
    scope_key: string
    expected_guardian_version: number
    status: string
    expires_at: string
  }>()
  if (!request || request.status !== 'PENDING') {
    throw new Error('guardian reset request is not pending')
  }
  const occurredAt = timestamp(input.occurredAt, 'occurredAt')
  if (Date.parse(request.expires_at) <= Date.parse(occurredAt)) {
    throw new Error('guardian reset request is expired')
  }

  const guardian = await env.DB.prepare(
    `SELECT status, version, reset_requires_dual_approval
       FROM live_guardian_states
      WHERE scope_type = ? AND scope_key = ?
      LIMIT 1`,
  ).bind(request.scope_type, request.scope_key).first<{
    status: GuardianStatus
    version: number
    reset_requires_dual_approval: number
  }>()
  if (!guardian || guardian.status === 'CLEAR') {
    throw new Error('guardian scope is already clear or missing')
  }
  if (guardian.version !== request.expected_guardian_version) {
    throw new Error('guardian state changed after reset request creation')
  }

  const approvals = await env.DB.prepare(
    `SELECT COUNT(DISTINCT approver_id) AS count,
            COUNT(DISTINCT approval_role) AS roles
       FROM live_guardian_reset_approvals
      WHERE reset_request_id = ?`,
  ).bind(input.resetRequestId).first<{ count: number; roles: number }>()
  const requiredApprovals = guardian.reset_requires_dual_approval === 1 ? 2 : 1
  if (Number(approvals?.count ?? 0) < requiredApprovals) {
    throw new Error('guardian reset does not have enough distinct approvals')
  }
  if (requiredApprovals === 2 && Number(approvals?.roles ?? 0) < 2) {
    throw new Error('guardian reset requires both risk and release approval roles')
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE live_guardian_states
          SET status = 'CLEAR', reason_code = NULL, reason_detail = NULL,
              triggered_by = NULL, triggered_at = NULL,
              version = version + 1, updated_at = CURRENT_TIMESTAMP
        WHERE scope_type = ? AND scope_key = ? AND version = ?`,
    ).bind(request.scope_type, request.scope_key, request.expected_guardian_version),
    env.DB.prepare(
      `UPDATE live_guardian_reset_requests
          SET status = 'APPLIED', applied_at = ?
        WHERE reset_request_id = ? AND status = 'PENDING'`,
    ).bind(occurredAt, input.resetRequestId),
    env.DB.prepare(
      `INSERT INTO live_guardian_events (
         event_id, scope_type, scope_key, previous_status, next_status,
         reason_code, reason_detail, actor_id, correlation_id,
         audit_event_hash, occurred_at
       ) VALUES (?, ?, ?, ?, 'CLEAR', 'DUAL_APPROVED_RESET', ?, ?, ?, ?, ?)`,
    ).bind(
      required(input.eventId, 'eventId'),
      request.scope_type,
      request.scope_key,
      guardian.status,
      `Reset request ${input.resetRequestId}`,
      required(input.actorId, 'actorId'),
      required(input.correlationId, 'correlationId'),
      hash(input.auditEventHash, 'auditEventHash'),
      occurredAt,
    ),
  ])
}
