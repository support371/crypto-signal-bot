import worker, { type Env } from './index'
import { fastPathDecisionMetrics, fastPathFeedRegistry } from './fast-path'
import { buildV2InfrastructureStatus } from './routes/v2-infrastructure'
import { buildV2MarketFeedsStatus } from './routes/v2-market-feeds'

type AgentEnv = Env & {
  AGENT_MEMORY?: KVNamespace
}

type D1ReadonlyRequest = {
  sql?: string
  params?: unknown[]
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

function corsHeaders(request: Request, env: Env): Headers {
  const configured = env.CORS_ALLOWED_ORIGINS
    ? env.CORS_ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    : ['*']
  const origin = request.headers.get('Origin') ?? '*'
  const allowedOrigin = configured.includes('*')
    ? origin
    : configured.includes(origin)
      ? origin
      : configured[0] ?? 'null'
  const headers = new Headers({
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
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

async function handleAgentContext(request: Request, env: AgentEnv): Promise<Response> {
  const url = new URL(request.url)
  const base = `${url.origin}`

  const [runtime, guardian, signal, portfolio, feed] = await Promise.allSettled([
    fetch(`${base}/runtime/status`).then(r => r.json()),
    fetch(`${base}/guardian/status`).then(r => r.json()),
    fetch(`${base}/signal/latest`).then(r => r.json()),
    fetch(`${base}/portfolio/summary`).then(r => r.json()),
    fetch(`${base}/market/feed/status`).then(r => r.json()),
  ])

  const memoryAvailable = !!env.AGENT_MEMORY

  return Response.json({
    ts: new Date().toISOString(),
    memory_available: memoryAvailable,
    runtime: runtime.status === 'fulfilled' ? runtime.value : { error: 'unavailable' },
    guardian: guardian.status === 'fulfilled' ? guardian.value : { error: 'unavailable' },
    signal: signal.status === 'fulfilled' ? signal.value : { error: 'unavailable' },
    portfolio: portfolio.status === 'fulfilled' ? portfolio.value : { error: 'unavailable' },
    market_feed: feed.status === 'fulfilled' ? feed.value : { error: 'unavailable' },
  })
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

export default {
  async fetch(request: Request, env: AgentEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/v2/')) {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
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

    const memoryMatch = url.pathname.match(/^\/agent\/memory\/([^/]+)$/)
    if (memoryMatch) {
      return handleAgentMemory(request, env, decodeURIComponent(memoryMatch[1]))
    }

    if (request.method === 'GET' && url.pathname === '/agent/context') {
      return handleAgentContext(request, env)
    }

    if (request.method === 'POST' && url.pathname === '/d1/query/readonly') {
      return handleReadonlyD1Query(request, env)
    }
    return worker.fetch(request, env, ctx)
  },

  scheduled: worker.scheduled,
}
