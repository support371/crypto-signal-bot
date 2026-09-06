const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const TIMEOUT_MS = 8000;

function json(response, status, payload) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex');
  response.status(status).json(payload);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }

  const operatorKey = process.env.BACKEND_API_KEY?.trim();
  if (!operatorKey) {
    return json(response, 503, {
      ok: false,
      worker: WORKER,
      server_operator_key_configured: false,
      server_operator_key_verified: false,
      bootstrap_state: 'SERVER_OPERATOR_KEY_NOT_CONFIGURED',
      note: 'No secret value is exposed by this endpoint.',
    });
  }

  try {
    const upstream = await fetch(`${WORKER}/v1/management/bootstrap`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-API-Key': operatorKey,
        'X-Request-ID': crypto.randomUUID(),
      },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });

    const text = await upstream.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    const code = typeof body?.code === 'string' ? body.code : null;
    const keyVerified = (upstream.status === 401 && code === 'UNAUTHENTICATED')
      || (upstream.status === 409 && code === 'BOOTSTRAP_CLOSED');
    const bootstrapState = upstream.status === 409 && code === 'BOOTSTRAP_CLOSED'
      ? 'CLOSED'
      : upstream.status === 401 && code === 'UNAUTHENTICATED'
        ? 'OPEN_REQUIRES_AAL2_IDENTITY'
        : keyVerified
          ? 'READY'
          : 'SERVER_OPERATOR_KEY_NOT_VERIFIED';

    return json(response, keyVerified ? 200 : 503, {
      ok: keyVerified,
      worker: WORKER,
      server_operator_key_configured: true,
      server_operator_key_verified: keyVerified,
      bootstrap_state: bootstrapState,
      upstream_status: upstream.status,
      upstream_code: code,
      note: 'This is a non-mutating readiness probe. The server operator key is never returned.',
    });
  } catch (error) {
    return json(response, 503, {
      ok: false,
      worker: WORKER,
      server_operator_key_configured: true,
      server_operator_key_verified: false,
      bootstrap_state: 'DEPENDENCY_UNAVAILABLE',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
