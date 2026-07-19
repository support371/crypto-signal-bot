import worker from './index_agent_context'
import type { AgentContextEnv } from './agent-context'
import { evaluateLiveCandidateReadiness } from './live/release-gate'
import {
  liveCandidateJson,
  liveCandidatePreflight,
  withLiveCandidateSecurityHeaders,
} from './live/live-candidate-response.ts'
import {
  routeOperatorReadRequest,
  type OperatorReadHttpEnv,
} from './live/operator-read-http.ts'

export { ExchangeAccountCoordinator } from './live/observed-account-coordinator'

type Env = AgentContextEnv & OperatorReadHttpEnv & {
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

    if (method === 'OPTIONS') return liveCandidatePreflight(request, env)

    const operatorResponse = await routeOperatorReadRequest(request, env)
    if (operatorResponse !== null) return operatorResponse

    if (method === 'GET' && pathname === '/v1/live/readiness') {
      const report = await evaluateLiveCandidateReadiness(env)
      return liveCandidateJson(request, env, report, 503)
    }

    if (method === 'GET' && pathname === '/v1/live/capabilities') {
      return liveCandidateJson(request, env, {
        environment: 'live-candidate',
        order_submission: false,
        order_cancellation: false,
        withdrawals: false,
        deposits: false,
        account_coordinator: 'execution-locked-internal-with-reporting-observability',
        durable_idempotency: 'schema-and-service-only',
        exact_decimal_arithmetic: true,
        readiness_endpoint: '/v1/live/readiness',
        operator_read_prefix: '/v1/operator/',
        operator_deployment_readiness_endpoint: '/v1/operator/deployment-readiness',
        reason: 'Candidate entrypoint is intentionally read-only',
      })
    }

    if (pathname.startsWith('/internal/') || pathname.startsWith('/v1/live/coordinator')) {
      return liveCandidateJson(request, env, {
        error: 'Internal coordinator routes are not publicly exposed',
        code: 'INTERNAL_ROUTE_NOT_EXPOSED',
      }, 404)
    }

    if (LEGACY_FINANCIAL_PATHS.has(pathname) || pathname.startsWith('/v1/orders') || pathname.startsWith('/v1/withdrawals')) {
      return liveCandidateJson(request, env, {
        error: 'Financial mutations are disabled in the live candidate build',
        code: 'LIVE_CANDIDATE_READ_ONLY',
      }, 403)
    }

    if (!SAFE_METHODS.has(method)) {
      return liveCandidateJson(request, env, {
        error: 'Mutations are disabled in the live candidate build',
        code: 'LIVE_CANDIDATE_READ_ONLY',
      }, 403)
    }

    if (isSensitiveRead(pathname)) {
      const auth = authenticate(env, request)
      if (auth === 'missing') {
        return liveCandidateJson(request, env, {
          error: 'Operator authentication is not configured',
          code: 'OPERATOR_AUTH_NOT_CONFIGURED',
        }, 503)
      }
      if (auth === 'invalid') {
        return liveCandidateJson(request, env, { error: 'Unauthorized', code: 401 }, 401)
      }
    }

    return withLiveCandidateSecurityHeaders(request, env, await worker.fetch(request, env, ctx))
  },

  scheduled: worker.scheduled,
}
