const WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const TIMEOUT_MS = 8000;

const checks = [
  { id: 'health', method: 'GET', path: '/healthz', expect: 200 },
  { id: 'runtime', method: 'GET', path: '/runtime/status', expect: 200 },
  { id: 'infra', method: 'GET', path: '/v2/infrastructure/status', expect: 200 },
  { id: 'breakers', method: 'GET', path: '/exchange/circuit-breakers', expect: 200 },
  { id: 'paper-auth', method: 'POST', path: '/intent/paper', expect: 401, body: { symbol: 'BTCUSDT', side: 'BUY', notional_usdt: 1, idempotency_key: 'anonymous-trust-probe' } },
  { id: 'live-blocked', method: 'POST', path: '/intent/live', expect: 403, body: {} },
  { id: 'live-order-blocked', method: 'POST', path: '/live/order', expect: 403, body: {} },
  { id: 'withdraw-blocked', method: 'POST', path: '/withdraw', expect: 403, body: {} },
  { id: 'ws-upgrade-required', method: 'GET', path: '/ws/updates', expect: 426 },
];

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

async function runCheck(check) {
  const started = Date.now();
  try {
    const headers = { accept: 'application/json' };
    const init = {
      method: check.method,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
      cache: 'no-store',
    };
    if (check.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(check.body);
    }

    const response = await fetch(new URL(check.path, `${WORKER}/`), init);
    const latency = Date.now() - started;
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }

    return {
      id: check.id,
      method: check.method,
      path: check.path,
      expected_status: check.expect,
      actual_status: response.status,
      passed: response.status === check.expect,
      latency_ms: latency,
      code: body && typeof body === 'object' ? body.code ?? body.error ?? null : null,
    };
  } catch (error) {
    return {
      id: check.id,
      method: check.method,
      path: check.path,
      expected_status: check.expect,
      actual_status: null,
      passed: false,
      latency_ms: Date.now() - started,
      error: errorText(error),
    };
  }
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const started = Date.now();
  const results = await Promise.all(checks.map(runCheck));
  const latencies = results.filter((item) => item.actual_status !== null).map((item) => item.latency_ms);
  const failures = results.filter((item) => !item.passed);

  const report = {
    ok: failures.length === 0,
    probe_version: '2026-09-10.1',
    generated_at: new Date().toISOString(),
    worker: WORKER,
    mode: 'paper-certification',
    safety_contract: {
      anonymous_paper_execution_blocked: results.find((r) => r.id === 'paper-auth')?.passed ?? false,
      live_execution_blocked: results.find((r) => r.id === 'live-blocked')?.passed ?? false,
      live_order_blocked: results.find((r) => r.id === 'live-order-blocked')?.passed ?? false,
      withdrawals_blocked: results.find((r) => r.id === 'withdraw-blocked')?.passed ?? false,
      websocket_upgrade_enforced: results.find((r) => r.id === 'ws-upgrade-required')?.passed ?? false,
    },
    latency: {
      p50_ms: percentile(latencies, 50),
      p95_ms: percentile(latencies, 95),
      max_ms: latencies.length ? Math.max(...latencies) : null,
      total_probe_ms: Date.now() - started,
    },
    results,
    failures,
  };

  return res.status(report.ok ? 200 : 503).json(report);
}
