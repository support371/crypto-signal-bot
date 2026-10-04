import { evaluateAuthorization, type ScopedRole, type StepUpSession } from './authorization.ts'

export class OrderCompletionAuthorizationError extends Error {
  readonly code = 'ORDER_COMPLETION_AUTHORIZATION_DENIED'
}

/** Completion authority is distinct from trading and accounting approval. */
export async function assertCurrentOrderCompletionAuthorization(
  env: { DB: D1Database }, accountId: string, orderId: string, authorizationEventId: string,
  evaluatedAt: string,
): Promise<void> {
  const denied = (): never => { throw new OrderCompletionAuthorizationError('current completion authority is unavailable') }
  const canonicalTime = (value: string): boolean => Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value
  const now = Date.parse(evaluatedAt)
  if (!canonicalTime(evaluatedAt)) return denied()
  const order = await env.DB.prepare(`SELECT a.exchange_name FROM live_orders o
    JOIN live_exchange_accounts a ON a.exchange_account_id = o.exchange_account_id
    WHERE o.internal_order_id = ? AND o.exchange_account_id = ?`)
    .bind(orderId, accountId).first<{ exchange_name: string }>()
  const evidence = await env.DB.prepare(`SELECT actor_id, action, resource_type, resource_id,
    decision, step_up_required, step_up_session_id, occurred_at FROM live_authorization_events
    WHERE authorization_event_id = ?`).bind(authorizationEventId).first<{
      actor_id: string; action: string; resource_type: string; resource_id: string; decision: string;
      step_up_required: number; step_up_session_id: string | null; occurred_at: string;
    }>()
  if (!order || !evidence || evidence.action !== 'RUN_RECONCILIATION'
    || evidence.resource_type !== 'ORDER_COMPLETION' || evidence.resource_id !== orderId
    || evidence.decision !== 'ALLOW' || evidence.step_up_required !== 1 || !evidence.step_up_session_id
    || !canonicalTime(evidence.occurred_at) || Date.parse(evidence.occurred_at) > now
    || now - Date.parse(evidence.occurred_at) >= 300_000) return denied()
  const roles = (await env.DB.prepare(`SELECT role, scope_type, scope_key, expires_at, revoked_at
    FROM live_actor_roles WHERE actor_id = ?`).bind(evidence.actor_id).all<{
      role: ScopedRole['role']; scope_type: ScopedRole['scopeType']; scope_key: string;
      expires_at: string | null; revoked_at: string | null;
    }>()).results
  const session = await env.DB.prepare(`SELECT step_up_session_id, actor_id, assurance_level,
    audience, issued_at, expires_at, revoked_at FROM live_step_up_sessions
    WHERE step_up_session_id = ?`).bind(evidence.step_up_session_id).first<{
      step_up_session_id: string; actor_id: string; assurance_level: StepUpSession['assuranceLevel'];
      audience: string; issued_at: string; expires_at: string; revoked_at: string | null;
    }>()
  if (!session || !canonicalTime(session.issued_at) || !canonicalTime(session.expires_at)
    || roles.some((r) => r.expires_at !== null && !canonicalTime(r.expires_at))) return denied()
  const decision = evaluateAuthorization({ actorId: evidence.actor_id, action: 'RUN_RECONCILIATION',
    resourceType: 'ORDER_COMPLETION', resourceId: orderId, exchangeAccountId: accountId,
    exchangeName: order.exchange_name, resourceOwnerActorId: null,
    evaluatedAt, roles: roles.map((r) => ({ role: r.role, scopeType: r.scope_type,
      scopeKey: r.scope_key, expiresAt: r.expires_at, revokedAt: r.revoked_at })),
    stepUpSession: { stepUpSessionId: session.step_up_session_id, actorId: session.actor_id,
      assuranceLevel: session.assurance_level, audience: session.audience,
      issuedAt: session.issued_at, expiresAt: session.expires_at, revokedAt: session.revoked_at },
  })
  if (!decision.allowed || !decision.matchedRoles.some((r) => r === 'RISK_OPERATOR' || r === 'RISK_ADMIN')) return denied()
}
