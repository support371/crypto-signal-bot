import worker from './index_agent_context'
import type { AgentContextEnv } from './agent-context'
import {
  evaluateLiveCandidateReadiness,
  type LiveGateEnv,
} from './live/release-gate'

export { ExchangeAccountCoordinator } from './live/observed-account-coordinator'

type Env = AgentContextEnv & LiveGateEnv & {
  EXCHANGE_ACCOUNT_COORDINATOR: DurableObjectNamespace
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const LEGACY_FINANCIAL_PATHS = new Set([
  '/intent/live',
  '/withdraw',
  '/live/order',
  '/live/trade',
  '/orders',
  '/order',
])
const SENSITIVE_READ_PREFIXES = ['/agent/memory/', '/audit', '/system/config']

function configuredOrigins(env: Env): string[] {
  return String(env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter((value) => value.length > 0 && !value.includes('*'))
}

function securityHeaders(request: Request, env: Env, response: Response): Response {
  const headers = new Headers(response.headers)
  const origin = request.headers.get('Origin')?.trim().replace(/\/$/, '')

  headers.delete('Access-Control-Allow-Origin')
  headers.delete('Access-Control-Allow-Credentials')
  headers.set('Cache-Control', 'no-store')
  headers.set('Vary', 'Origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('X-Live-Candidate', 'read-only')

  if (origin && configuredOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function json(request: Request, env: Env, payload: unknown, status = 200): Response {
  return securityHeaders(
    request,
    env,
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  )
}

function authenticate(env: Env, request: Request): 'valid' | 'missing' | 'invalid' {
  const expected = String(env.BACKEND_API_KEY ?? '').trim()
  if (!expected) return 'missing'

  const supplied = (
    request.headers.get('X-API-Key')
    ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  ).trim()

  return supplied === expected ? 'valid' : 'invalid'
}

function preflight(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin')?.trim().replace(/\/$/, '')
  if (!origin || !configuredOrigins(env).includes(origin)) {
    return json(request, env, { error: 'Origin not allowed' }, 403)
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, Idempotency-Key',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Live-Candidate': 'read-only',
    },
  })
}

function isSensitiveRead(pathname: string): boolean {
  return SENSITIVE_READ_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  )
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname
    const method = request.method.toUpperCase()

    if (method === 'OPTIONS') return preflight(request, env)

    if (method === 'GET' && pathname === '/v1/live/readiness') {
      const report = await evaluateLiveCandidateReadiness(env)
      return json(request, env, report, 503)
    }

    if (method === 'GET' && pathname === '/v1/live/capabilities') {
      return json(request, env, {
        environment: 'live-candidate',
        order_submission: false,
        order_cancellation: false,
        withdrawals: false,
        deposits: false,
        account_coordinator: 'execution-locked-internal-with-reporting-observability',
        durable_idempotency: 'schema-and-service-only',
        exact_decimal_arithmetic: true,
        readiness_endpoint: '/v1/live/readiness',
        reason: 'Candidate entrypoint is intentionally read-only',
      })
    }

    if (pathname.startsWith('/internal/') || pathname.startsWith('/v1/live/coordinator')) {
      return json(request, env, {
        error: 'Internal coordinator routes are not publicly exposed',
        code: 'INTERNAL_ROUTE_NOT_EXPOSED',
      }, 404)
    }

    if (LEGACY_FINANCIAL_PATHS.has(pathname) || pathname.startsWith('/v1/orders') || pathname.startsWith('/v1/withdrawals')) {
      return json(request, env, {
        error: 'Financial mutations are disabled in the live candidate build',
        code: 'LIVE_CANDIDATE_READ_ONLY',
      }, 403)
    }

    if (!SAFE_METHODS.has(method)) {
      return json(request, env, {
        error: 'Mutations are disabled in the live candidate build',
        code: 'LIVE_CANDIDATE_READ_ONLY',
      }, 403)
    }

    if (isSensitiveRead(pathname)) {
      const auth = authenticate(env, request)
      if (auth === 'missing') {
        return json(request, env, {
          error: 'Operator authentication is not configured',
          code: 'OPERATOR_AUTH_NOT_CONFIGURED',
        }, 503)
      }
      if (auth === 'invalid') {
        return json(request, env, { error: 'Unauthorized', code: 401 }, 401)
      }
    }

    return securityHeaders(request, env, await worker.fetch(request, env, ctx))
  },

  scheduled: worker.scheduled,
}
