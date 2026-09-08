const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const TIMEOUT_MS = 12000;
const DEMO_PATH = '/operator/paper-demo/e7d98447?confirm=paper-10k-e7d98447';

function json(response, status, payload) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  response.status(status).json(payload);
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return json(response, 405, { ok: false, error: 'method_not_allowed' });
  }

  try {
    const upstream = await fetch(`${WORKER}${DEMO_PATH}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    });

    const text = await upstream.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }

    return json(response, upstream.status, body ?? {
      ok: false,
      error: 'empty_worker_response',
      upstream_status: upstream.status,
    });
  } catch (error) {
    return json(response, 503, {
      ok: false,
      error: 'paper_test_dependency_error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
