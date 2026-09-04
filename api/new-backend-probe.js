const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';

const checks = [
  ['GET', '/healthz'],
  ['GET', '/runtime/status'],
  ['GET', '/v2/infrastructure/status'],
  ['GET', '/agent/context'],
  ['GET', '/exchange/circuit-breakers'],
];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'GET') return res.status(405).json({ ok: false });

  const results = [];
  for (const [method, path] of checks) {
    try {
      const r = await fetch(new URL(path, WORKER), {
        method,
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      const text = await r.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch {}
      results.push({ path, status: r.status, contentType: r.headers.get('content-type'), body, text: body ? undefined : text.slice(0, 220) });
    } catch (error) {
      results.push({ path, status: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const health = results.find((r) => r.path === '/healthz');
  const runtime = results.find((r) => r.path === '/runtime/status');
  const ok = health?.status === 200 && health?.body?.status === 'ok' && runtime?.status === 200;
  return res.status(ok ? 200 : 503).json({ ok, worker: WORKER, results });
}
