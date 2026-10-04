import { authenticateOperatorRead, parseOperatorKeyHashes, sha256Hex, constantTimeHexEqual,
  type OperatorReadAuthEnv } from './operator-read-auth.ts'

export interface ReviewedOperationsEnv extends OperatorReadAuthEnv {
  EXCHANGE_ACCOUNT_COORDINATOR: DurableObjectNamespace
  CANDIDATE_ACCOUNTING_TOKEN?: string
}

const routes = {
  '/reviewed/reservations/settle': { keys: ['fillId', 'authorizationEventId'], target: '/candidate/reservations/settle' },
  '/reviewed/orders/complete': { keys: ['orderId', 'authorizationEventId'], target: '/candidate/orders/complete' },
  '/reviewed/recovery-accounting/dispatch': { keys: ['dispatchId', 'planId', 'approvalEventId'], target: '/candidate/recovery-accounting/dispatch' },
} as const
const identifier = /^[A-Za-z0-9:_-]{1,128}$/
const response = (code: string, status: number) => Response.json({ code, providerMutationAllowed: false,
  executionAllowed: false }, { status, headers: { 'Cache-Control': 'no-store' } })

async function readCommand(request: Request, keys: readonly string[]): Promise<Record<string, string>> {
  const reader = request.body?.getReader()
  if (!reader) throw new TypeError('body required')
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 8192) { await reader.cancel().catch(() => {}); throw new RangeError('body limit') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const input: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).length !== keys.length
    || !keys.every((key) => typeof (input as Record<string, unknown>)[key] === 'string'
      && identifier.test((input as Record<string, string>)[key]))) throw new TypeError('immutable IDs only')
  return input as Record<string, string>
}

/** Service-binding ingress only. No new coordinator, approval recorder or provider transport. */
export async function routeReviewedOperation(request: Request, env: ReviewedOperationsEnv): Promise<Response> {
  const path = new URL(request.url).pathname
  const route = routes[path as keyof typeof routes]
  if (!route) return response('REVIEWED_ROUTE_NOT_FOUND', 404)
  if (request.method !== 'POST') return response('REVIEWED_METHOD_NOT_ALLOWED', 405)
  if (!env.EXCHANGE_ACCOUNT_COORDINATOR || !env.CANDIDATE_ACCOUNTING_TOKEN?.trim()) {
    return response('REVIEWED_OPERATIONS_NOT_CONFIGURED', 503)
  }
  // Validate identity before touching D1 or reading command data. The later scoped
  // role lookup reuses the existing operator policy; the coordinator reloads
  // operation-specific authority again inside its account serialization queue.
  const configured = parseOperatorKeyHashes(env.OPERATOR_API_KEY_HASHES)
  if (!Object.keys(configured).length) return response('OPERATOR_AUTH_NOT_CONFIGURED', 503)
  const actorId = request.headers.get('X-Operator-Id')?.trim() ?? ''
  const secret = (request.headers.get('X-API-Key')
    ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '').trim()
  if (!configured[actorId] || !secret || !constantTimeHexEqual(await sha256Hex(secret), configured[actorId])) {
    return response('OPERATOR_AUTHENTICATION_FAILED', 401)
  }
  try {
    const input = await readCommand(request, route.keys)
    const scope = path === '/reviewed/orders/complete'
      ? await env.DB.prepare(`SELECT o.exchange_account_id, a.exchange_name, e.actor_id
          FROM live_orders o JOIN live_exchange_accounts a ON a.exchange_account_id=o.exchange_account_id
          JOIN live_authorization_events e ON e.resource_id=o.internal_order_id
          WHERE o.internal_order_id=? AND e.authorization_event_id=?
            AND e.resource_type='ORDER_COMPLETION' AND e.action='RUN_RECONCILIATION' AND e.decision='ALLOW'`)
        .bind(input.orderId, input.authorizationEventId).first<{ exchange_account_id: string; exchange_name: string; actor_id: string }>()
      : path === '/reviewed/reservations/settle'
      ? await env.DB.prepare(`SELECT o.exchange_account_id, a.exchange_name, e.actor_id
          FROM live_fills f JOIN live_orders o ON o.internal_order_id=f.internal_order_id
          JOIN live_exchange_accounts a ON a.exchange_account_id=o.exchange_account_id
          JOIN live_authorization_events e ON e.resource_id=o.internal_order_id
          WHERE f.fill_id=? AND e.authorization_event_id=? AND e.resource_type='ORDER_RESERVATION_SETTLEMENT'
            AND e.action='RUN_RECONCILIATION' AND e.decision='ALLOW'`)
        .bind(input.fillId,input.authorizationEventId).first<{ exchange_account_id: string; exchange_name: string; actor_id: string }>()
      : await env.DB.prepare(`SELECT p.exchange_account_id, p.exchange_name, e.actor_id
          FROM live_recovery_accounting_plans p JOIN live_recovery_accounting_approval_events e ON e.plan_id=p.plan_id
          WHERE p.plan_id=? AND e.approval_event_id=? AND e.decision='APPROVED' AND e.authorization_allowed=1`)
        .bind(input.planId, input.approvalEventId).first<{ exchange_account_id: string; exchange_name: string; actor_id: string }>()
    if (!scope || !identifier.test(scope.exchange_account_id) || scope.actor_id !== actorId) {
      return response('REVIEWED_AUTHORITY_SCOPE_DENIED', 403)
    }
    const auth = await authenticateOperatorRead(env, request, { resource: 'RECONCILIATION',
      exchangeName: scope.exchange_name, exchangeAccountId: scope.exchange_account_id })
    if (auth.status !== 'AUTHORIZED' || !auth.principal.matchedRoles.some((r) => r === 'RISK_OPERATOR' || r === 'RISK_ADMIN')) {
      return response('REVIEWED_CURRENT_ROLE_DENIED', 403)
    }
    const id = env.EXCHANGE_ACCOUNT_COORDINATOR.idFromName(scope.exchange_account_id)
    // Forward only the validated immutable identifiers and internal credential.
    // Caller-supplied routing, credentials and scope headers cannot reach the DO.
    return await env.EXCHANGE_ACCOUNT_COORDINATOR.get(id).fetch(new Request(`https://coordinator${route.target}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-Candidate-Accounting-Token': env.CANDIDATE_ACCOUNTING_TOKEN.trim() }, body: JSON.stringify(input),
    }))
  } catch (error) {
    return response(error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError
      ? 'INVALID_REVIEWED_COMMAND' : 'REVIEWED_OPERATION_UNAVAILABLE',
    error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError ? 400 : 503)
  }
}
