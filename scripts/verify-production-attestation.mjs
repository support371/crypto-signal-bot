const DEFAULT_FRONTEND_URL = 'https://crypto-signal-bot-indol.vercel.app';
const CURRENT_WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const REQUEST_TIMEOUT_MS = 12_000;

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a URL`);
  return value.replace(/\/+$/, '');
}

const frontendUrl = readArgument('--frontend', DEFAULT_FRONTEND_URL);

async function json(path) {
  const response = await fetch(new URL(path, `${frontendUrl}/`), {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
    redirect: 'error',
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${path} returned non-JSON content: ${text.slice(0, 160)}`);
  }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const release = await json('/release.json');
assert(release.response.status === 200, `release.json returned HTTP ${release.response.status}`);
assert(release.body?.attestation_path === '/api/release-attestation', 'release manifest does not advertise the attestation endpoint');
assert(release.body?.backend_url === CURRENT_WORKER, `release manifest points to ${release.body?.backend_url ?? 'no Worker'}`);

const attestation = await json(release.body.attestation_path);
assert(attestation.response.status === 200, `release attestation returned HTTP ${attestation.response.status}`);
assert(attestation.body?.ok === true, `release attestation is degraded: ${JSON.stringify(attestation.body?.failures ?? [])}`);
assert(attestation.body?.worker === CURRENT_WORKER, `attestation points to ${attestation.body?.worker ?? 'no Worker'}`);
assert(attestation.body?.execution?.primary === 'btcc', 'attestation does not identify BTCC as primary execution exchange');
assert(attestation.body?.execution?.secondary === 'bitget', 'attestation does not identify Bitget as secondary execution exchange');
assert(attestation.body?.safety?.trading_mode === 'paper', 'attestation trading mode is not paper');
assert(attestation.body?.safety?.network === 'testnet', 'attestation network is not testnet');
assert(attestation.body?.safety?.allow_mainnet === false, 'attestation allows mainnet');
assert(attestation.body?.safety?.live_trading_enabled === false, 'attestation enables live trading');
assert(attestation.body?.safety?.withdrawals_enabled === false, 'attestation enables withdrawals');
assert(attestation.body?.safety?.provider_mutation_enabled === false, 'attestation enables provider mutation');
assert(attestation.body?.safety?.real_funds_enabled === false, 'attestation enables real-fund activity');
assert(attestation.body?.storage?.d1_status === 'healthy', 'D1 is not healthy in the release attestation');
assert(attestation.body?.storage?.agent_memory_available === true, 'agent memory is not available in the release attestation');
assert(Array.isArray(attestation.body?.failures) && attestation.body.failures.length === 0, 'release attestation contains invariant failures');

console.log(`Production attestation verified: ${frontendUrl} → ${CURRENT_WORKER}; execution BTCC→Bitget; paper/testnet locks intact.`);
