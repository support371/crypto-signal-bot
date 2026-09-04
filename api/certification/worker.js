const WORKER_URL = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev';

const checks = [
  {
    path: '/healthz',
    statuses: [200],
    validate: (body) => body?.status === 'ok',
  },
  {
    path: '/runtime/status',
    statuses: [200],
    validate: (body) => body?.trading_mode === 'paper' && body?.allow_mainnet === false,
  },
  {
    path: '/surge/status',
    statuses: [200],
    validate: (body) => body?.scanner_active === true,
  },
  {
    path: '/guardian/status',
    statuses: [200],
    validate: (body) => Object.prototype.hasOwnProperty.call(body ?? {}, 'triggered'),
  },
  {
    path: '/portfolio/summary',
    statuses: [200],
    validate: (body) => body?.mode === 'paper',
  },
  {
    path: '/market/feed/status',
    statuses: [200],
    validate: (body) => body?.primary === 'coinbase',
  },
  {
    path: '/exchange/circuit-breakers',
    statuses: [200],
    validate: (body) => Array.isArray(body?.adapters),
  },
  {
    path: '/v2/infrastructure/status',
    statuses: [200],
    validate: (body) =>
      body?.version === '2.0' &&
      body?.runtime?.trading_mode === 'paper' &&
      body?.runtime?.allow_mainnet === false,
  },
  {
    path: '/agent/context',
    statuses: [200, 207],
    validate: (body) =>
      body?.certification_mode === true &&
      body?.provider_mutation_enabled === false &&
      body?.real_funds_enabled === false,
  },
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
    response.status(405).json({
      ok: false,
      error: 'Read-only certification probe',
    });
    return;
  }

  const results = [];

  for (const check of checks) {
    try {
      const upstream = await fetch(new URL(check.path, WORKER_URL), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      const text = await upstream.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }

      const pass = check.statuses.includes(upstream.status) && body !== null && check.validate(body);
      results.push({
        path: check.path,
        status: upstream.status,
        pass,
      });
    } catch (error) {
      results.push({
        path: check.path,
        status: null,
        pass: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const passed = results.filter((item) => item.pass).length;
  const ok = passed === results.length;

  response.status(ok ? 200 : 503).json({
    ok,
    worker: WORKER_URL,
    mode_expected: 'paper',
    network_expected: 'testnet',
    checks_passed: passed,
    checks_total: results.length,
    results,
  });
}
