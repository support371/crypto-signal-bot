export interface LiveCandidateResponseEnv {
  CORS_ALLOWED_ORIGINS?: string
}

export function configuredLiveCandidateOrigins(env: LiveCandidateResponseEnv): readonly string[] {
  return Object.freeze(String(env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter((value) => value.length > 0 && !value.includes('*')))
}

export function withLiveCandidateSecurityHeaders(
  request: Request,
  env: LiveCandidateResponseEnv,
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
  headers.set('X-Live-Candidate', 'read-only')

  if (origin && configuredLiveCandidateOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export function liveCandidateJson(
  request: Request,
  env: LiveCandidateResponseEnv,
  payload: unknown,
  status = 200,
): Response {
  return withLiveCandidateSecurityHeaders(
    request,
    env,
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  )
}

export function liveCandidatePreflight(
  request: Request,
  env: LiveCandidateResponseEnv,
): Response {
  const origin = request.headers.get('Origin')?.trim().replace(/\/$/, '')
  if (!origin || !configuredLiveCandidateOrigins(env).includes(origin)) {
    return liveCandidateJson(request, env, { error: 'Origin not allowed' }, 403)
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Operator-Id, Idempotency-Key',
      'Access-Control-Max-Age': '600',
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'X-Live-Candidate': 'read-only',
    },
  })
}
