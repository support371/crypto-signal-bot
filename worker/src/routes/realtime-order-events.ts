import { evaluateAuthorization, type ScopedRole } from '../live/authorization.ts'
import { authenticateManagedRead, type ManagementEnv } from '../management.ts'

export interface RealtimeReadPrincipal { actorId: string; roles: readonly ScopedRole[] }
export interface RealtimeOrderEvent {
  type: 'order_state'; sequence_id: number; event_id: string; order_id: string
  account_id: string; previous_state: string | null; state: string
  source: string; occurred_at: string; evidence_hash: string; audit_hash: string
}

/** Only immutable event fields are projected, never current mutable fill values. */
export async function readAuthorizedOrderEvents(
  DB: D1Database, principal: RealtimeReadPrincipal, after: number, now = new Date().toISOString(),
): Promise<RealtimeOrderEvent[]> {
  if (!Number.isSafeInteger(after) || after < 0) throw new TypeError('invalid event cursor')
  const accounts = await DB.prepare(`SELECT exchange_account_id, exchange_name
    FROM live_exchange_accounts ORDER BY exchange_account_id LIMIT 51`).all<{ exchange_account_id: string; exchange_name: string }>()
  if ((accounts.results?.length ?? 0) > 50) throw new TypeError('account read scope exceeds bounded stream capacity')
  const authorized = (accounts.results ?? []).filter((account) => evaluateAuthorization({
    actorId: principal.actorId, action: 'READ_ACCOUNT', resourceType: 'EXCHANGE_ACCOUNT',
    resourceId: account.exchange_account_id, exchangeName: account.exchange_name,
    exchangeAccountId: account.exchange_account_id, resourceOwnerActorId: null,
    roles: principal.roles, stepUpSession: null, evaluatedAt: now,
  }).allowed).map((account) => account.exchange_account_id)
  if (!authorized.length) return []
  const rows = await DB.prepare(`SELECT e.sequence_id, e.event_id, e.internal_order_id,
    o.exchange_account_id, e.previous_state, e.next_state, e.source, e.occurred_at, e.payload_hash, e.audit_event_hash
    FROM live_order_events e JOIN live_orders o ON o.internal_order_id = e.internal_order_id
    WHERE e.sequence_id > ? AND o.exchange_account_id IN (${authorized.map(() => '?').join(',')})
    ORDER BY e.sequence_id ASC LIMIT 100`).bind(after, ...authorized).all<{
      sequence_id: number; event_id: string; internal_order_id: string; exchange_account_id: string
      previous_state: string | null; next_state: string; source: string; occurred_at: string
      payload_hash: string; audit_event_hash: string
    }>()
  return (rows.results ?? []).map((row) => {
    if (!Number.isSafeInteger(row.sequence_id) || row.sequence_id <= after
      || !/^[a-f0-9]{64}$/.test(row.payload_hash) || !/^[a-f0-9]{64}$/.test(row.audit_event_hash)) {
      throw new TypeError('invalid persisted event evidence')
    }
    return { type: 'order_state', sequence_id: row.sequence_id, event_id: row.event_id,
      order_id: row.internal_order_id, account_id: row.exchange_account_id, previous_state: row.previous_state,
      state: row.next_state, source: row.source, occurred_at: row.occurred_at,
      evidence_hash: row.payload_hash, audit_hash: row.audit_event_hash }
  })
}

/** Session tokens arrive only in WebSocket frames, never URLs or public status. */
export function createRealtimeOrderDelivery(
  request: Request, env: ManagementEnv, send: (payload: unknown) => void,
  dependencies: {
    authorize?: typeof authenticateManagedRead
    read?: typeof readAuthorizedOrderEvents
  } = {},
) {
  let token: string | null = null
  let cursor = 0
  let generation = 0
  let closed = false
  let refreshing = false
  let actorId: string | null = null
  const authorize = dependencies.authorize ?? authenticateManagedRead
  const read = dependencies.read ?? readAuthorizedOrderEvents
  const refresh = async () => {
    if (!token || closed || refreshing) return
    const ownGeneration = generation
    refreshing = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const headers = new Headers(request.headers)
      headers.set('Authorization', `Bearer ${token}`)
      // Bound the entire shared identity/role/read operation even on a stalled dependency.
      const operation = (async () => {
        const principal = await authorize(new Request(request.url, { headers }), env)
        if (!principal || (actorId !== null && actorId !== principal.actorId)) throw new Error('read identity unavailable')
        const events = await read(env.DB, principal, cursor)
        return { principal, events }
      })()
      const outcome = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('read deadline exceeded')), 8_000)
      })])
      if (closed || ownGeneration !== generation) return
      actorId = outcome.principal.actorId
      for (const event of outcome.events) {
        send(event)
        cursor = event.sequence_id
      }
      send({ type: 'order_stream_status', authenticated: true, cursor })
    } catch {
      if (!closed && ownGeneration === generation) {
        token = null
        send({ type: 'order_stream_status', authenticated: false, code: 'ORDER_READ_UNAVAILABLE' })
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      refreshing = false
      if (!closed && token && ownGeneration !== generation) void refresh()
    }
  }
  return {
    refresh,
    async authenticate(message: unknown) {
      if (closed) return
      const value = message as { access_token?: unknown; after_sequence?: unknown }
      generation += 1
      token = null
      actorId = null
      if (!value || typeof value.access_token !== 'string' || value.access_token.length > 8192
        || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.access_token)
        || !Number.isSafeInteger(value.after_sequence) || Number(value.after_sequence) < 0) {
        send({ type: 'order_stream_status', authenticated: false, code: 'ORDER_READ_UNAVAILABLE' })
        return
      }
      token = value.access_token
      cursor = Number(value.after_sequence)
      await refresh()
    },
    close() { closed = true; generation += 1; token = null; actorId = null },
  }
}
