const RESPONSE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Certification-Diagnostic': 'read-only',
});

const DEFAULT_BACKEND_URL = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev';
const HEALTH_TIMEOUT_MS = 4_000;

function sendJson(response, status, payload, suppressBody = false) {
  for (const [name, value] of Object.entries(RESPONSE_HEADERS)) {
    response.setHeader(name, value);
  }
  response.statusCode = status;
  response.end(suppressBody ? undefined : JSON.stringify(payload));
}

function resolveTarget() {
  const configured = process.env.CERTIFICATION_BACKEND_URL ?? process.env.VITE_BACKEND_URL ?? DEFAULT_BACKEND_URL;
  const source = process.env.CERTIFICATION_BACKEND_URL
    ? 'CERTIFICATION_BACKEND_URL'
    : process.env.VITE_BACKEND_URL
      ? 'VITE_BACKEND_URL'
      : 'repository-default';

  let url;
  try {
    url = new URL(configured);
  } catch {
    return { ok: false, source, reason: 'invalid-url' };
  }

  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.workers.dev') ||
    url.username ||
    url.password ||
    url.port
  ) {
    return { ok: false, source, reason: 'target-policy-rejected' };
  }

  url.pathname = '/health';
  url.search = '';
  url.hash = '';
  return { ok: true, source, url };
}

export default async function handler(request, response) {
  const method = String(request.method ?? 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    response.setHeader('Allow', 'GET, HEAD, OPTIONS');
    response.setHeader('Cache-Control', 'no-store');
    response.statusCode = 204;
    response.end();
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD, OPTIONS');
    sendJson(response, 405, {
      error: 'Backend health diagnostic is read only',
      code: 'BACKEND_HEALTH_DIAGNOSTIC_READ_ONLY',
      readOnly: true,
    }, method === 'HEAD');
    return;
  }

  const target = resolveTarget();
  if (!target.ok) {
    sendJson(response, 200, {
      schemaVersion: 'certification-backend-health.v1',
      readOnly: true,
      checkedAt: new Date().toISOString(),
      target: { configured: false, source: target.source, host: 'unavailable' },
      result: { state: target.reason, reachable: false, healthy: false, statusCode: null, latencyMs: 0 },
      responseBodyRead: false,
      retriesAttempted: 0,
    }, method === 'HEAD');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const upstream = await fetch(target.url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });

    sendJson(response, 200, {
      schemaVersion: 'certification-backend-health.v1',
      readOnly: true,
      checkedAt: new Date().toISOString(),
      target: { configured: true, source: target.source, host: target.url.host },
      result: {
        state: upstream.ok ? 'healthy' : 'unhealthy-response',
        reachable: true,
        healthy: upstream.ok,
        statusCode: upstream.status,
        latencyMs: Date.now() - startedAt,
      },
      responseBodyRead: false,
      retriesAttempted: 0,
    }, method === 'HEAD');
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    sendJson(response, 200, {
      schemaVersion: 'certification-backend-health.v1',
      readOnly: true,
      checkedAt: new Date().toISOString(),
      target: { configured: true, source: target.source, host: target.url.host },
      result: {
        state: timedOut ? 'timeout' : 'unreachable',
        reachable: false,
        healthy: false,
        statusCode: null,
        latencyMs: Date.now() - startedAt,
      },
      responseBodyRead: false,
      retriesAttempted: 0,
    }, method === 'HEAD');
  } finally {
    clearTimeout(timeout);
  }
}
