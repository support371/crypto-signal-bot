import worker, { requireApiKey, type Env } from './index'
import { fastPathDecisionMetrics, fastPathFeedRegistry } from './fast-path'
import { buildV2InfrastructureStatus } from './routes/v2-infrastructure'
import { buildV2MarketFeedsStatus } from './routes/v2-market-feeds'
import {
  handleAgentContextRequest,
  type AgentContextEnv,
} from './agent-context'
import {
  ensureManagementSchema,
  handleManagementRequest,
  type ManagementEnv,
} from './management'
import { hasActiveGlobalReleaseAdmin } from './management-bootstrap-guard'

type AgentEnv = AgentContextEnv & ManagementEnv

type D1ReadonlyRequest = {
  sql?: string
  params?: unknown[]
}

type ManagementRoleGrant = {
  role?: string
  scope_type?: string
  scope_key?: string
}

type ManagementMePayload = {
  profile?: { status?: string }
  roles?: ManagementRoleGrant[]
  access_allowed?: boolean
}

function numberOr(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function isSelectOnly(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
  const firstToken = stripped.split(/\s+/)[0].toUpperCase()
  if (firstToken === 'SELECT') return true
  if (firstToken === 'WITH') {
    const upper = stripped.toUpperCase()
    const hasDml = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE)\b/.test(upper)
    return !hasDml
  }
  return false
}

function configuredOrigins(env: Env): string[] {
  return env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    : ['*']
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  if (!origin) return true
  const configured = configuredOrigins(env)
  return configured.includes('*') || configured.includes(origin)
}

function corsHeaders(request: Request, env: Env): Headers {
  const configured = configuredOrigins(env)
  const origin = request.headers.get('Origin') ?? '*'
  const allowedOrigin = configured.includes('*')
    ? origin
    : configured.includes(origin)
      ? origin
      : configured[0] ?? 'null'
  const headers = new Headers({
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Request-ID',
    'Access-Control-Expose-Headers': 'X-Request-ID, Retry-After',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin',
  })
  return headers
}

function jsonResponse(request: Request, env: Env, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: corsHeaders(request, env),
  })
}

function unauthorizedResponse(request: Request, env: Env): Response {
  return jsonResponse(request, env, { error: 'Unauthorized', code: 401 }, 401)
}

async function handleReadonlyD1Query(request: Request, env: Env): Promise<Response> {
  let body: D1ReadonlyRequest
  try {
    body = await request.json() as D1ReadonlyRequest
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const sql = String(body.sql ?? '').trim()
  if (!sql) {
    return Response.json({ error: 'sql is required' }, { status: 400 })
  }

  if (!isSelectOnly(sql)) {
    return Response.json(
      { error: 'Only SELECT queries are permitted on this endpoint' },
      { status: 400 },
    )
  }

  const params = Array.isArray(body.params) ? body.params : []
  const result = await env.DB.prepare(sql).bind(...params).all()
  return Response.json({ result, readonly: true })
}

async function handleAgentMemory(request: Request, env: AgentEnv, key: string): Promise<Response> {
  if (!env.AGENT_MEMORY) {
    return Response.json({ error: 'AGENT_MEMORY KV namespace not bound' }, { status: 503 })
  }

  if (request.method === 'GET') {
    const value = await env.AGENT_MEMORY.get(key, { type: 'json' })
    return Response.json({ key, value, ts: Date.now() })
  }

  if (request.method === 'POST') {
    const body = await request.json() as { value: unknown }
    await env.AGENT_MEMORY.put(key, JSON.stringify(body.value), {
      expirationTtl: 60 * 60 * 24 * 30,
    })
    return Response.json({ key, value: body.value, ts: Date.now() })
  }

  if (request.method === 'DELETE') {
    await env.AGENT_MEMORY.delete(key)
    return Response.json({ deleted: true, key, ts: Date.now() })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405 })
}

async function readD1Status(env: Env): Promise<'healthy' | 'unavailable'> {
  try {
    await env.DB.prepare('SELECT 1 AS ok').first()
    return 'healthy'
  } catch {
    return 'unavailable'
  }
}

async function readGuardianSnapshot(env: Env) {
  const row = await env.DB.prepare(
    'SELECT triggered, reason, drawdown_pct FROM guardian_state WHERE id = 1 LIMIT 1',
  ).first<{ triggered: number | boolean; reason: string | null; drawdown_pct: number }>().catch(() => null)
  return {
    halted: row?.triggered === true || row?.triggered === 1,
    reason: row?.reason ?? null,
    drawdownPct: numberOr(row?.drawdown_pct),
    maxDrawdownPct: numberOr(env.GUARDIAN_MAX_DRAWDOWN_PCT, 15),
  }
}

async function handleV2Infrastructure(request: Request, env: Env): Promise<Response> {
  const nowMs = Date.now()
  const [guardian, d1Status] = await Promise.all([
    readGuardianSnapshot(env),
    readD1Status(env),
  ])
  const payload = buildV2InfrastructureStatus({
    guardian,
    d1Status,
    feeds: fastPathFeedRegistry.list(nowMs),
    metrics: fastPathDecisionMetrics,
    nowMs,
  })
  return jsonResponse(request, env, payload)
}

function handleV2MarketFeeds(request: Request, env: Env): Response {
  const nowMs = Date.now()
  return jsonResponse(
    request,
    env,
    buildV2MarketFeedsStatus(fastPathFeedRegistry.list(nowMs), nowMs),
  )
}

function handleV2DecisionMetrics(request: Request, env: Env): Response {
  const url = new URL(request.url)
  const window = url.searchParams.get('window') ?? '15m'
  return jsonResponse(request, env, fastPathDecisionMetrics.snapshot(window))
}

async function guardInitialManagementBootstrap(
  request: Request,
  env: AgentEnv,
): Promise<Response | null> {
  try {
    await ensureManagementSchema(env)
    if (await hasActiveGlobalReleaseAdmin(env)) {
      return jsonResponse(request, env, {
        error: 'Initial RELEASE_ADMIN bootstrap is closed because an active global release administrator already exists.',
        code: 'BOOTSTRAP_CLOSED',
        live_capabilities_remain_disabled: true,
      }, 409)
    }
    return null
  } catch {
    return jsonResponse(request, env, {
      error: 'Unable to verify management bootstrap state.',
      code: 'DEPENDENCY_UNAVAILABLE',
    }, 503)
  }
}

async function authorizePaperIntent(request: Request, env: AgentEnv): Promise<Response | null> {
  const authorization = request.headers.get('Authorization')?.trim()
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    return jsonResponse(request, env, {
      error: 'A valid authenticated session is required for paper execution.',
      code: 'UNAUTHENTICATED',
    }, 401)
  }

  const url = new URL(request.url)
  url.pathname = '/v1/management/me'
  url.search = ''

  const headers = new Headers({
    Authorization: authorization,
    Accept: 'application/json',
  })
  const origin = request.headers.get('Origin')
  if (origin) headers.set('Origin', origin)
  const suppliedRequestId = request.headers.get('X-Request-ID')
  if (suppliedRequestId) headers.set('X-Request-ID', suppliedRequestId)

  const authResponse = await handleManagementRequest(
    new Request(url.toString(), { method: 'GET', headers }),
    env,
  )
  if (!authResponse.ok) return authResponse

  const payload = await authResponse.json().catch(() => null) as ManagementMePayload | null
  if (payload?.profile?.status !== 'ACTIVE' || payload.access_allowed !== true) {
    return jsonResponse(request, env, {
      error: 'Account access is not active.',
      code: 'FORBIDDEN',
    }, 403)
  }

  const permittedRoles = new Set(['TRADER', 'RISK_OPERATOR', 'RISK_ADMIN', 'RELEASE_ADMIN'])
  const authorized = (payload.roles ?? []).some((grant) => {
    if (!grant.role || !permittedRoles.has(grant.role)) return false
    const globalScope = grant.scope_type === 'GLOBAL' && grant.scope_key === 'global'
    const paperAccountScope = grant.scope_type === 'ACCOUNT' && grant.scope_key === 'paper'
    return globalScope || paperAccountScope
  })

  if (!authorized) {
    return jsonResponse(request, env, {
      error: 'A paper-trading role is required for this rehearsal action.',
      code: 'FORBIDDEN',
      required_roles: Array.from(permittedRoles),
      accepted_scopes: ['GLOBAL:global', 'ACCOUNT:paper'],
    }, 403)
  }

  return null
}

async function handlePaperIntent(
  request: Request,
  env: AgentEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const authBlock = await authorizePaperIntent(request, env)
  if (authBlock) return authBlock

  const operatorKey = env.BACKEND_API_KEY?.trim()
  if (!operatorKey) {
    return jsonResponse(request, env, {
      error: 'Server-side paper execution authority is not configured.',
      code: 'DEPENDENCY_UNAVAILABLE',
    }, 503)
  }

  const body = await request.text()
  const internalUrl = new URL(request.url)
  internalUrl.pathname = '/orders'
  internalUrl.search = ''
  const headers = new Headers(request.headers)
  headers.delete('Authorization')
  headers.set('X-API-Key', operatorKey)
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json')

  return worker.fetch(new Request(internalUrl.toString(), {
    method: 'POST',
    headers,
    body,
  }), env, ctx)
}

async function handleRealtimeWebSocket(request: Request, env: AgentEnv): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return jsonResponse(request, env, {
      error: 'WebSocket upgrade required.',
      code: 'UPGRADE_REQUIRED',
    }, 426)
  }

  if (!isAllowedOrigin(request, env)) {
    return jsonResponse(request, env, {
      error: 'Origin is not allowed for realtime status.',
      code: 'FORBIDDEN',
    }, 403)
  }

  const pair = new WebSocketPair()
  const client = pair[0]
  const server = pair[1]
  server.accept()

  const guardian = await readGuardianSnapshot(env)
  server.send(JSON.stringify({
    type: 'status',
    ws: 'connected',
    backend: 'cloudflare-worker',
    mode: 'paper',
    timestamp: Date.now(),
  }))
  server.send(JSON.stringify({
    type: 'health',
    kill_switch_active: guardian.halted,
    mode: 'paper',
    api_error_count: 0,
    guardian_triggered: guardian.halted,
    market_data_mode: 'live_public_paper',
    market_data_connected: true,
  }))
  server.send(JSON.stringify({
    type: 'exchange_status',
    exchange: 'coinbase',
    market_data_mode: 'live_public_paper',
    connected: true,
    connection_state: 'connected',
    fallback_active: false,
    last_update_ts: Date.now(),
    last_error: null,
    stale: false,
    symbols: ['BTC', 'ETH', 'SOL', 'BNB'],
    source: 'coinbase',
  }))

  server.addEventListener('message', (event) => {
    if (String(event.data).toLowerCase() === 'ping') {
      server.send(JSON.stringify({
        type: 'status',
        ws: 'connected',
        backend: 'cloudflare-worker',
        mode: 'paper',
        timestamp: Date.now(),
      }))
    }
  })

  return new Response(null, { status: 101, webSocket: client })
}

export default {
  async fetch(request: Request, env: AgentEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    const memoryMatch = url.pathname.match(/^\/agent\/memory\/([^/]+)$/)
    const isPrivilegedD1Query = url.pathname === '/d1/query/readonly'
    const isManagementRoute = url.pathname.startsWith('/v1/management/')
    const isManagementBootstrap = url.pathname === '/v1/management/bootstrap'
    const isRealtimeRoute = url.pathname === '/ws/updates' || url.pathname === '/ws' || url.pathname === '/stream'

    if (request.method === 'OPTIONS' && (
      url.pathname.startsWith('/v2/')
      || Boolean(memoryMatch)
      || isPrivilegedD1Query
      || isManagementRoute
      || url.pathname === '/intent/paper'
    )) {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    if ((memoryMatch || isPrivilegedD1Query) && !requireApiKey(env, request)) {
      return unauthorizedResponse(request, env)
    }

    if (isManagementBootstrap && !requireApiKey(env, request)) {
      return unauthorizedResponse(request, env)
    }

    if (isManagementBootstrap) {
      const bootstrapBlock = await guardInitialManagementBootstrap(request, env)
      if (bootstrapBlock) return bootstrapBlock
    }

    if (isManagementRoute) {
      return handleManagementRequest(request, env, {
        bootstrapAuthorized: isManagementBootstrap,
      })
    }

    if (request.method === 'POST' && url.pathname === '/intent/paper') {
      return handlePaperIntent(request, env, ctx)
    }

    if (request.method === 'GET' && isRealtimeRoute) {
      return handleRealtimeWebSocket(request, env)
    }

    if (request.method === 'GET' && url.pathname === '/v2/infrastructure/status') {
      return handleV2Infrastructure(request, env)
    }

    if (request.method === 'GET' && url.pathname === '/v2/market/feeds/status') {
      return handleV2MarketFeeds(request, env)
    }

    if (request.method === 'GET' && url.pathname === '/v2/metrics/decision') {
      return handleV2DecisionMetrics(request, env)
    }

    if (memoryMatch) {
      return handleAgentMemory(request, env, decodeURIComponent(memoryMatch[1]))
    }

    if (request.method === 'GET' && url.pathname === '/agent/context') {
      return handleAgentContextRequest(request, env)
    }

    if (request.method === 'POST' && url.pathname === '/d1/query/readonly') {
      return handleReadonlyD1Query(request, env)
    }
    return worker.fetch(request, env, ctx)
  },

  scheduled: worker.scheduled,
}
