import type { Env } from './index'

export type RequestAdmissionEnv = Pick<
  Env,
  'DB' | 'RATE_LIMIT_RPM' | 'CORS_ALLOWED_ORIGINS'
>

export type RequestAdmissionResult =
  | { status: 'allowed'; limit: number; count: number; remaining: number }
  | { status: 'limited'; limit: number }
  | { status: 'unavailable' }

export const DEFAULT_RATE_LIMIT_RPM = 120
export const MAX_RATE_LIMIT_RPM = 10_000
export const REQUEST_ADMISSION_RETENTION_MINUTES = 2

export const REQUEST_ADMISSION_SQL = `
INSERT INTO request_admission_counters (bucket, count, expires_at)
VALUES (?1, 1, ?2)
ON CONFLICT(bucket) DO UPDATE SET
  count = request_admission_counters.count + 1,
  expires_at = excluded.expires_at
WHERE request_admission_counters.count < ?3
RETURNING count
`.trim()

const PURGE_EXPIRED_ADMISSION_SQL =
  'DELETE FROM request_admission_counters WHERE expires_at <= ?1'

function boundedRateLimit(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RATE_LIMIT_RPM
  return Math.min(Math.floor(parsed), MAX_RATE_LIMIT_RPM)
}

function clientIdentity(request: Request): string {
  const connectingIp = request.headers.get('CF-Connecting-IP')?.trim()
  if (!connectingIp) return 'unknown'

  // Cloudflare owns this header at the edge. Bound the persisted identifier so
  // malformed local/dev requests cannot create unbounded D1 primary keys.
  return connectingIp.slice(0, 128)
}

export async function evaluateRequestAdmission(
  request: Request,
  env: RequestAdmissionEnv,
  nowMs = Date.now(),
): Promise<RequestAdmissionResult> {
  const limit = boundedRateLimit(env.RATE_LIMIT_RPM)
  const minute = Math.floor(nowMs / 60_000)
  const expiresAt = (minute + REQUEST_ADMISSION_RETENTION_MINUTES) * 60_000
  const bucket = `${clientIdentity(request)}:${minute}`

  try {
    const row = await env.DB.prepare(REQUEST_ADMISSION_SQL)
      .bind(bucket, expiresAt, limit)
      .first<{ count: number }>()

    // The conditional UPSERT returns no row once the existing atomic count has
    // reached the configured limit. Rejected requests are not written again.
    if (!row) return { status: 'limited', limit }

    const count = Number(row.count)
    if (!Number.isSafeInteger(count) || count < 1 || count > limit) {
      return { status: 'unavailable' }
    }

    return {
      status: 'allowed',
      limit,
      count,
      remaining: Math.max(0, limit - count),
    }
  } catch {
    // D1 is the authority for this distributed boundary. A storage or schema
    // failure must not silently downgrade to an uncoordinated allow decision.
    return { status: 'unavailable' }
  }
}

export async function purgeExpiredRequestAdmissionCounters(
  env: Pick<RequestAdmissionEnv, 'DB'>,
  nowMs = Date.now(),
): Promise<boolean> {
  try {
    await env.DB.prepare(PURGE_EXPIRED_ADMISSION_SQL).bind(nowMs).run()
    return true
  } catch {
    return false
  }
}

function corsHeaders(request: Request, env: Pick<RequestAdmissionEnv, 'CORS_ALLOWED_ORIGINS'>): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
  })

  const requestOrigin = request.headers.get('Origin')
  const configured = String(env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (requestOrigin && (configured.includes('*') || configured.includes(requestOrigin))) {
    headers.set('Access-Control-Allow-Origin', requestOrigin)
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key')
  }

  return headers
}

export function requestAdmissionFailureResponse(
  request: Request,
  env: Pick<RequestAdmissionEnv, 'CORS_ALLOWED_ORIGINS'>,
  result: Exclude<RequestAdmissionResult, { status: 'allowed' }>,
): Response {
  const headers = corsHeaders(request, env)

  if (result.status === 'limited') {
    headers.set('Retry-After', '60')
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        code: 'REQUEST_RATE_LIMITED',
        retry_after: 60,
      }),
      { status: 429, headers },
    )
  }

  headers.set('Retry-After', '5')
  return new Response(
    JSON.stringify({
      error: 'Request admission temporarily unavailable',
      code: 'REQUEST_ADMISSION_UNAVAILABLE',
      retry_after: 5,
    }),
    { status: 503, headers },
  )
}
