import worker from './index_agent_context'
import type { AgentContextEnv } from './agent-context'

type Env = AgentContextEnv

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const PERMANENT_403_PATHS = new Set([
  '/intent/live',
  '/withdraw',
  '/live/order',
  '/live/trade',
])
const SENSITIVE_READ_PREFIXES = ['/agent/memory/']

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function origins(env: Env): string[] {
  return String(env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter((value) => value.length > 0 && !value.includes('*'))
}

function withHeaders(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers)
  const origin = request.headers.get('Origin')?.trim().replace(/\/$/, '')

  headers.delete('Access-Control-Allow-Origin')
  headers.delete('Access-Control-Allow-Credentials')
  headers.set('Vary', 'Origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  if (origin && origins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function json(request: Request, env: Env, body: unknown, status = 200): Response {
  return withHeaders(new Response(
    request.method === 'HEAD' ? null : JSON.stringify(body),
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      },
    },
  ), request, env)
}

function auth(env: Env, request: Request): 'missing' | 'valid' | 'invalid' {
  const expected = String(env.BACKEND_API_KEY ?? '').trim()
  if (!expected) return 'missing'

  const supplied = (
    request.headers.get('X-API-Key')
    ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  ).trim()

  return supplied === expected ? 'valid' : 'invalid'
}

function needsAuth(request: Request, pathname: string): boolean {
  if (!SAFE_METHODS.has(request.method.toUpperCase())) return true
  return SENSITIVE_READ_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

async function checks(env: Env): Promise<Record<string, boolean>> {
  let d1 = false
  try {
    await env.DB.prepare('SELECT 1 AS ok').first()
    d1 = true
  } catch {
    d1 = false
  }

  const configuredOrigins = origins(env)
  const rawOrigins = String(env.CORS_ALLOWED_ORIGINS ?? '')

  return {
    paper_mode: normalized(env.TRADING_MODE) === 'paper',
    exchange_paper_mode: normalized(env.EXCHANGE_MODE) === 'paper',
    testnet_network: normalized(env.NETWORK) === 'testnet',
    mainnet_disabled: !['1', 'true', 'yes', 'on'].includes(normalized(env.ALLOW_MAINNET)),
    operator_auth_configured: String(env.BACKEND_API_KEY ?? '').trim().length > 0,
    cors_exact_origins: configuredOrigins.length > 0 && !rawOrigins.includes('*'),
    d1_reachable: d1,
    r2_bound: Boolean(env.STORAGE),
  }
}

async function ready(request: Request, env: Env): Promise<Response> {
  const result = await checks(env)
  const paperReady = Object.values(result).every(Boolean)
  return json(request, env, {
    status: paperReady ? 'ok' : 'blocked',
    ready: paperReady,
    paper_ready: paperReady,
    live_ready: false,
    runtime: 'cloudflare-workers',
    mode: 'paper',
    network: 'testnet',
    allow_mainnet: false,
    checks: result,
    ts: Date.now(),
  }, paperReady ? 200 : 503)
}

function preflight(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin')?.trim().replace(/\/$/, '')
  if (!origin || !origins(env).includes(origin)) {
    return json(request, env, { error: 'Origin not allowed' }, 403)
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Idempotency-Key',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
    },
  })
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const pathname = new URL(request.url).pathname
    const method = request.method.toUpperCase()

    if (method === 'OPTIONS') return preflight(request, env)

    if (PERMANENT_403_PATHS.has(pathname)) {
      const response = await worker.fetch(request, env, ctx)
      return withHeaders(response, request, env)
    }

    if (needsAuth(request, pathname)) {
      const state = auth(env, request)
      if (state === 'missing') {
        return json(request, env, {
          error: 'Operator authentication is not configured',
          code: 'OPERATOR_AUTH_NOT_CONFIGURED',
        }, 503)
      }
      if (state === 'invalid') {
        return json(request, env, { error: 'Unauthorized', code: 401 }, 401)
      }
    }

    if ((method === 'GET' || method === 'HEAD') &&
        (pathname === '/ready' || pathname === '/trading-readiness')) {
      return ready(request, env)
    }

    return withHeaders(await worker.fetch(request, env, ctx), request, env)
  },

  scheduled: worker.scheduled,
}
