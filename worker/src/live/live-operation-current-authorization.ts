import { evaluateAuthorization, type ScopedRole, type StepUpSession } from './authorization.ts'
import { canonicalHash } from './canonical-json.ts'

export interface CurrentTradingAuthorityInput {
  actorId: string
  authorizationEventId: string
  authorizationAuditHash: string
  stepUpSessionId: string
  orderId: string
  accountId: string
  accountRefHash: string
  exchange: 'BITGET' | 'BTCC'
  productId: string
  operation: 'PLACE' | 'CANCEL'
}

type Row = Record<string, unknown>
const identifier = /^[A-Za-z0-9:._-]{1,128}$/
const hash = /^[a-f0-9]{64}$/
const MAX_RELOAD_MS = 2_000

export class CurrentTradingAuthorityError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.name = 'CurrentTradingAuthorityError'; this.code = code }
}
const deny = (code: string): never => { throw new CurrentTradingAuthorityError(code) }
function time(value: unknown): number {
  if (typeof value !== 'string') return NaN
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN
}
function now(clock: () => Date): number {
  const value = clock()
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.getTime() : deny('CURRENT_TRADING_CLOCK_INVALID')
}

/**
 * Reload current authority inside the serialized account operation. Historical
 * role JSON in an ALLOW event cannot authorize a revoked trader/session. This
 * snapshot is one prerequisite, not an execution token: risk, Guardian, actual
 * reservations, external certification, release and atomic admission remain
 * independent controls. No credentials, transport or Worker route are present.
 */
export async function reloadCurrentTradingAuthority(
  env: { DB: D1Database }, input: Readonly<CurrentTradingAuthorityInput>, clock: () => Date,
) {
  // Retain exactly these scalar fields across awaits; caller mutation cannot
  // rebind a database read to a different operation while it is in flight.
  input = Object.freeze({ actorId: input.actorId, authorizationEventId: input.authorizationEventId,
    authorizationAuditHash: input.authorizationAuditHash, stepUpSessionId: input.stepUpSessionId,
    orderId: input.orderId, accountId: input.accountId, accountRefHash: input.accountRefHash,
    exchange: input.exchange, productId: input.productId, operation: input.operation })
  for (const value of [input.actorId, input.authorizationEventId, input.stepUpSessionId, input.orderId, input.accountId]) {
    if (!identifier.test(value)) deny('CURRENT_TRADING_IDENTITY_INVALID')
  }
  if (!hash.test(input.accountRefHash) || !hash.test(input.authorizationAuditHash)
    || !['BITGET', 'BTCC'].includes(input.exchange) || !['PLACE', 'CANCEL'].includes(input.operation)
    || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(input.productId)) deny('CURRENT_TRADING_SCOPE_INVALID')
  const started = now(clock)
  // D1 batch is a single transactional snapshot of all five authoritative reads.
  // Neither current role nor session is supplied by the request/old ALLOW JSON.
  let reads: D1Result<Row>[]
  try {
    reads = await env.DB.batch<Row>([
      env.DB.prepare(`SELECT actor_id, action, resource_type, resource_id, step_up_session_id,
        decision, audit_event_hash, occurred_at FROM live_authorization_events WHERE authorization_event_id=?`).bind(input.authorizationEventId),
      env.DB.prepare(`SELECT role, scope_type, scope_key, expires_at, revoked_at FROM live_actor_roles
        WHERE actor_id=? ORDER BY role,scope_type,scope_key`).bind(input.actorId),
      env.DB.prepare(`SELECT step_up_session_id, actor_id, assurance_level, audience, issued_at, expires_at,
        revoked_at FROM live_step_up_sessions WHERE step_up_session_id=?`).bind(input.stepUpSessionId),
      env.DB.prepare(`SELECT exchange_name, external_account_ref_hash, status, eligible,
        reconciliation_clear FROM live_exchange_accounts WHERE exchange_account_id=?`).bind(input.accountId),
      env.DB.prepare(`SELECT exchange_account_id, product_id, state, settled, pending_cancel,
        client_order_id, exchange_order_id FROM live_orders WHERE internal_order_id=?`).bind(input.orderId),
    ])
  } catch { return deny('CURRENT_TRADING_AUTHORITY_UNAVAILABLE') }
  if (reads.length !== 5 || reads.some(r => r.success !== true || !Array.isArray(r.results))) deny('CURRENT_TRADING_AUTHORITY_UNAVAILABLE')
  const [events, roleRows, sessions, accounts, orders] = reads.map(r => r.results)
  if ([events, sessions, accounts, orders].some(rows => rows.length !== 1) || roleRows.length > 100) deny('CURRENT_TRADING_AUTHORITY_UNAVAILABLE')
  const event = events[0], session = sessions[0], account = accounts[0], order = orders[0]
  const action = input.operation === 'PLACE' ? 'CREATE_ORDER' : 'CANCEL_ORDER'
  const evaluatedMs = now(clock), evaluatedAt = new Date(evaluatedMs).toISOString()
  if (evaluatedMs < started || evaluatedMs - started > MAX_RELOAD_MS) deny('CURRENT_TRADING_AUTHORITY_STALE')
  if (event.actor_id !== input.actorId || event.action !== action || event.resource_type !== 'ORDER'
    || event.resource_id !== input.orderId || event.step_up_session_id !== input.stepUpSessionId
    || event.decision !== 'ALLOW' || event.audit_event_hash !== input.authorizationAuditHash
    || !Number.isFinite(time(event.occurred_at)) || time(event.occurred_at) > evaluatedMs) deny('CURRENT_TRADING_EVENT_MISMATCH')
  if (account.exchange_name !== input.exchange || account.external_account_ref_hash !== input.accountRefHash
    || order.exchange_account_id !== input.accountId || order.product_id !== input.productId) deny('CURRENT_TRADING_SCOPE_INVALID')
  if (order.settled !== 0 || (input.operation === 'PLACE'
    ? account.status !== 'READY' || account.eligible !== 1 || account.reconciliation_clear !== 1
      || !['RESERVED', 'PREVIEWING'].includes(String(order.state)) || order.pending_cancel !== 0
      || order.exchange_order_id !== null || !identifier.test(String(order.client_order_id ?? ''))
    : !['READY', 'RESTRICTED', 'HALTED'].includes(String(account.status))
      || !['SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED'].includes(String(order.state))
      || order.pending_cancel !== 0
      || (!identifier.test(String(order.exchange_order_id ?? '')) && !identifier.test(String(order.client_order_id ?? ''))))) {
    deny('CURRENT_TRADING_ORDER_NOT_ELIGIBLE')
  }
  const roles: ScopedRole[] = roleRows.map(row => {
    if (!['VIEWER','TRADER','RISK_OPERATOR','RISK_ADMIN','WITHDRAWAL_REQUESTER','WITHDRAWAL_APPROVER','AUDITOR','RELEASE_ADMIN'].includes(String(row.role))
      || !['GLOBAL','EXCHANGE','ACCOUNT'].includes(String(row.scope_type)) || typeof row.scope_key !== 'string'
      || (row.expires_at !== null && !Number.isFinite(time(row.expires_at)))
      || (row.revoked_at !== null && !Number.isFinite(time(row.revoked_at)))) deny('CURRENT_TRADING_AUTHORITY_INVALID')
    return { role: row.role as ScopedRole['role'], scopeType: row.scope_type as ScopedRole['scopeType'],
      scopeKey: row.scope_key as string, expiresAt: row.expires_at as string | null, revokedAt: row.revoked_at as string | null }
  })
  if (session.step_up_session_id !== input.stepUpSessionId || session.actor_id !== input.actorId
    || !Number.isFinite(time(session.issued_at)) || !Number.isFinite(time(session.expires_at))
    || time(event.occurred_at) < time(session.issued_at)
    || (session.revoked_at !== null && !Number.isFinite(time(session.revoked_at)))) deny('CURRENT_TRADING_AUTHORITY_INVALID')
  const stepUp: StepUpSession = { stepUpSessionId: input.stepUpSessionId, actorId: input.actorId,
    assuranceLevel: session.assurance_level as StepUpSession['assuranceLevel'], audience: String(session.audience),
    issuedAt: String(session.issued_at), expiresAt: String(session.expires_at), revokedAt: session.revoked_at as string | null }
  const decision = evaluateAuthorization({ actorId: input.actorId, action, resourceType: 'ORDER', resourceId: input.orderId,
    exchangeName: input.exchange, exchangeAccountId: input.accountId, resourceOwnerActorId: null,
    roles, stepUpSession: stepUp, evaluatedAt })
  if (!decision.allowed) deny('CURRENT_TRADING_AUTHORIZATION_DENIED')
  const authorityHash = await canonicalHash({ input, event, roles, stepUp, account, order, evaluatedAt })
  const completed = now(clock)
  if (completed < evaluatedMs || completed - started > MAX_RELOAD_MS || completed >= time(session.expires_at)
    || !evaluateAuthorization({ actorId: input.actorId, action, resourceType: 'ORDER', resourceId: input.orderId,
      exchangeName: input.exchange, exchangeAccountId: input.accountId, resourceOwnerActorId: null,
      roles, stepUpSession: stepUp, evaluatedAt: new Date(completed).toISOString() }).allowed) deny('CURRENT_TRADING_AUTHORITY_STALE')
  return Object.freeze({ actorId: input.actorId, accountId: input.accountId, orderId: input.orderId,
    operation: input.operation, evaluatedAt, authorityHash, currentAuthorizationSatisfied: true as const,
    executionAllowed: false as const, automaticRetryAllowed: false as const })
}
