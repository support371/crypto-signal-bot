const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const REQUEST_TIMEOUT_MS = 8000;

function safeError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function probeManagement() {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${WORKER}/v1/management/me`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });

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
    const authEnforced = response.status === 401 || response.status === 403 || response.status === 429;

    return {
      route_present: routePresent,
      identity_provider_configured: providerConfigured,
      authentication_enforced: authEnforced,
      status: response.status,
      code,
      latency_ms: Date.now() - startedAt,
      content_type: response.headers.get('content-type') ?? null,
      body: body && typeof body === 'object' ? body : undefined,
      text: body ? undefined : text.slice(0, 220),
    };
  } catch (error) {
    return {
      route_present: false,
      identity_provider_configured: false,
      authentication_enforced: false,
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

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const management = await probeManagement();
  const ok = management.route_present && management.identity_provider_configured && management.authentication_enforced;

  return res.status(ok ? 200 : 503).json({
    ok,
    generated_at: new Date().toISOString(),
    worker: WORKER,
    management,
    expected_anonymous_posture: '401/403/429 with route present and identity provider configured',
  });
}
