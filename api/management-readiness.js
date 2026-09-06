const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const CANONICAL_FRONTEND_ORIGIN = 'https://crypto-signal-bot-indol.vercel.app';
const REQUEST_TIMEOUT_MS = 8000;

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function probeManagement() {
  const startedAt = Date.now();
  try {
    const [response, preflight] = await Promise.all([
      fetch(`${WORKER}/v1/management/me`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          origin: CANONICAL_FRONTEND_ORIGIN,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
        cache: 'no-store',
      }),
      fetch(`${WORKER}/v1/management/me`, {
        method: 'OPTIONS',
        headers: {
          origin: CANONICAL_FRONTEND_ORIGIN,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'authorization,x-request-id',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error',
        cache: 'no-store',
      }),
    ]);

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const code = typeof body?.code === 'string' ? body.code : null;
    const routePresent = response.status !== 404;
    const providerConfigured = routePresent && !(response.status === 503 && code === 'AUTH_PROVIDER_UNCONFIGURED');
    const authEnforced = response.status === 401 && code === 'UNAUTHENTICATED';
    const allowOrigin = response.headers.get('access-control-allow-origin');
    const preflightAllowOrigin = preflight.headers.get('access-control-allow-origin');
    const corsAllowed = (allowOrigin === CANONICAL_FRONTEND_ORIGIN || allowOrigin === '*')
      && preflight.status === 204
      && (preflightAllowOrigin === CANONICAL_FRONTEND_ORIGIN || preflightAllowOrigin === '*');

    return {
      route_present: routePresent,
      identity_provider_configured: providerConfigured,
      authentication_enforced: authEnforced,
      canonical_cors_allowed: corsAllowed,
      status: response.status,
      code,
      latency_ms: Date.now() - startedAt,
      content_type: response.headers.get('content-type') ?? null,
      access_control_allow_origin: allowOrigin,
      preflight_status: preflight.status,
      preflight_allow_origin: preflightAllowOrigin,
      body: body && typeof body === 'object' ? body : undefined,
      text: body ? undefined : text.slice(0, 220),
    };
  } catch (error) {
    return {
      route_present: false,
      identity_provider_configured: false,
      authentication_enforced: false,
      canonical_cors_allowed: false,
      status: null,
      code: null,
      latency_ms: Date.now() - startedAt,
      error: safeError(error),
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const management = await probeManagement();
  const ok = management.route_present
    && management.identity_provider_configured
    && management.authentication_enforced
    && management.canonical_cors_allowed;

  return res.status(ok ? 200 : 503).json({
    ok,
    generated_at: new Date().toISOString(),
    worker: WORKER,
    canonical_frontend_origin: CANONICAL_FRONTEND_ORIGIN,
    management,
    expected_anonymous_posture: '401 UNAUTHENTICATED with the canonical origin permitted by GET and OPTIONS CORS responses',
  });
}
