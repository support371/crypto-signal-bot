const BACKEND = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev';
const TIMEOUT_MS = 12000;

async function probe(path, init = {}) {
  const started = Date.now();
  try {
    const response = await fetch(new URL(path, `${BACKEND}/`), {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json', ...(init.headers || {}) },
    });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch {}
    return {
      reachable: true,
      status: response.status,
      ms: Date.now() - started,
      body,
      text: body ? undefined : text.slice(0, 240),
    };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const [health, runtime, v2, agent, memory, d1, liveIntent, liveOrder, withdraw] = await Promise.all([
    probe('/healthz'),
    probe('/runtime/status'),
    probe('/v2/infrastructure/status'),
    probe('/agent/context'),
    probe('/agent/memory/release-auth-probe'),
    probe('/d1/query/readonly', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT 1 AS ok' }) }),
    probe('/intent/live', { method: 'POST' }),
    probe('/live/order', { method: 'POST' }),
    probe('/withdraw', { method: 'POST' }),
  ]);

  const checks = {
    health: health.status === 200 && health.body?.status === 'ok',
    runtime: runtime.status === 200 && runtime.body?.trading_mode === 'paper' && runtime.body?.exchange_mode === 'paper' && runtime.body?.network === 'testnet' && runtime.body?.allow_mainnet === false && runtime.body?.live_trading_enabled === false && runtime.body?.withdrawals_enabled === false,
    v2: v2.status === 200 && v2.body?.version === '2.0' && v2.body?.runtime?.trading_mode === 'paper' && v2.body?.runtime?.allow_mainnet === false && v2.body?.runtime?.live_trading_enabled === false && v2.body?.runtime?.withdrawals_enabled === false,
    agent: [200, 207].includes(agent.status) && agent.body?.certification_mode === true && agent.body?.trading_mode === 'paper' && agent.body?.network === 'testnet' && agent.body?.allow_mainnet === false && agent.body?.provider_mutation_enabled === false && agent.body?.real_funds_enabled === false && agent.body?.withdrawals_enabled === false,
    memoryAuth: memory.status === 401,
    d1Auth: d1.status === 401,
    liveIntentBlocked: liveIntent.status === 403,
    liveOrderBlocked: liveOrder.status === 403,
    withdrawBlocked: withdraw.status === 403,
  };

  const passed = Object.values(checks).every(Boolean);
  return res.status(passed ? 200 : 503).json({
    release: 'c9041d7f849fbbe141f52d9d9d3ec321fd668767',
    backend: BACKEND,
    passed,
    checks,
    probes: { health, runtime, v2, agent, memory, d1, liveIntent, liveOrder, withdraw },
  });
}
