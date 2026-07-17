type Env = {
  DB: D1Database
  STORAGE: R2Bucket
  BACKEND_API_KEY?: string
  CORS_ALLOWED_ORIGINS?: string
  WITHDRAWALS_ENABLED?: string
  TRANSFER_PROVIDER_CONFIGURED?: string
  TRANSFER_RESOURCES_CONFIGURED?: string
  BUILD_GIT_SHA?: string
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function enabled(value: unknown): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function origins(env: Env): string[] {
  return String(env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter((value) => value.length > 0 && !value.includes('*'))
}

function withSecurityHeaders(
  request: Request,
  env: Env,
  response: Response,
): Response {
  const headers = new Headers(response.headers)
  const origin = request.headers.get('Origin')?.trim().replace(/\/$/, '')

  headers.delete('Access-Control-Allow-Origin')
  headers.delete('Access-Control-Allow-Credentials')
  headers.set('Cache-Control', 'no-store')
  headers.set('Vary', 'Origin')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  headers.set('X-Transfer-Candidate', 'read-only')

  if (origin && origins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function json(
  request: Request,
  env: Env,
  payload: unknown,
  status = 200,
): Response {
  return withSecurityHeaders(
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
  if (!origin || !origins(env).includes(origin)) {
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
      'X-Transfer-Candidate': 'read-only',
    },
  })
}

async function schemaChecks(env: Env): Promise<Record<string, boolean>> {
  const tables = [
    'live_transfer_destinations',
    'live_deposits',
    'live_withdrawals',
    'live_withdrawal_approvals',
    'live_transfer_events',
  ]
  const checks: Record<string, boolean> = {}

  for (const table of tables) {
    try {
      const row = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
      ).bind(table).first<{ name: string }>()
      checks[`table_${table}`] = row?.name === table
    } catch {
      checks[`table_${table}`] = false
    }
  }
  return checks
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const method = request.method.toUpperCase()
    const pathname = new URL(request.url).pathname

    if (method === 'OPTIONS') return preflight(request, env)

    if (!SAFE_METHODS.has(method)) {
      return json(request, env, {
        error: 'Transfer mutations are disabled in the withdrawal candidate build',
        code: 'WITHDRAWAL_CANDIDATE_READ_ONLY',
      }, 403)
    }

    if (pathname === '/v1/transfers/readiness') {
      const checks = await schemaChecks(env)
      const reasons = Object.entries(checks)
        .filter(([, passed]) => !passed)
        .map(([name]) => name)
      if (enabled(env.WITHDRAWALS_ENABLED)) reasons.push('withdrawals_flag_must_remain_disabled')
      if (enabled(env.TRANSFER_PROVIDER_CONFIGURED)) reasons.push('provider_must_not_be_configured_in_candidate')
      if (!enabled(env.TRANSFER_RESOURCES_CONFIGURED)) reasons.push('isolated_transfer_resources_not_provisioned')
      reasons.push('candidate_build_cannot_submit_transfers')

      return json(request, env, {
        ready: false,
        withdrawalsReady: false,
        depositsObservationReady: false,
        environment: 'withdrawals-candidate',
        checks: {
          ...checks,
          withdrawals_disabled: !enabled(env.WITHDRAWALS_ENABLED),
          provider_not_configured: !enabled(env.TRANSFER_PROVIDER_CONFIGURED),
          isolated_resources_configured: enabled(env.TRANSFER_RESOURCES_CONFIGURED),
          candidate_submission_locked: true,
        },
        reasons,
        buildGitSha: String(env.BUILD_GIT_SHA ?? ''),
        evaluatedAt: new Date().toISOString(),
      }, 503)
    }

    if (pathname === '/v1/transfers/capabilities') {
      return json(request, env, {
        environment: 'withdrawals-candidate',
        deposit_observation: false,
        withdrawal_preview: false,
        withdrawal_submission: false,
        destination_management: false,
        provider_configured: false,
        credentials_present: false,
        separate_runtime: true,
        reason: 'Candidate transfer service is intentionally read-only and provider-disconnected',
      })
    }

    if (pathname.startsWith('/v1/deposits') || pathname.startsWith('/v1/withdrawals')) {
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
      return json(request, env, {
        error: 'Transfer records are not publicly exposed by the disabled candidate',
        code: 'TRANSFER_RECORDS_NOT_EXPOSED',
      }, 404)
    }

    return json(request, env, { error: 'Not found', path: pathname }, 404)
  },
}
