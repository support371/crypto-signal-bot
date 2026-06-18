import worker, { type Env } from './index'

type AgentEnv = Env & {
  AGENT_MEMORY?: KVNamespace
}

type D1ReadonlyRequest = {
  sql?: string
  params?: unknown[]
}

function isSelectOnly(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim();
  const firstToken = stripped.split(/\s+/)[0].toUpperCase();
  if (firstToken === 'SELECT') return true;
  if (firstToken === 'WITH') {
    const upper = stripped.toUpperCase();
    const hasDml = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE)\b/.test(upper);
    return !hasDml;
  }
  return false;
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

export default {
  async fetch(request: Request, env: AgentEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)

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
