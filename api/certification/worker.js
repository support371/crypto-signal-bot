const WORKER_URL = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev';

const paths = [
  '/healthz',
  '/runtime/status',
  '/surge/status',
  '/guardian/status',
  '/portfolio/summary',
  '/market/feed/status',
  '/exchange/circuit-breakers',
  '/v2/infrastructure/status',
  '/agent/context',
];

function setHeaders(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

export default async function handler(request, response) {
  setHeaders(response);

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ ok: false, error: 'Read-only certification probe' });
    return;
  }

  const results = [];

  for (const path of paths) {
    try {
      const upstream = await fetch(new URL(path, WORKER_URL), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      const text = await upstream.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = { non_json: text.slice(0, 1000) };
      }
      results.push({ path, status: upstream.status, body });
    } catch (error) {
      results.push({
        path,
        status: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  response.status(200).json({
    ok: true,
    worker: WORKER_URL,
    results,
  });
}
