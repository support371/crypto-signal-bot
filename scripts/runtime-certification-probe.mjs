const BACKEND = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev'
const FRONTEND = 'https://crypto-signal-bot-indol.vercel.app'
const TIMEOUT = 12000

const checkName = process.argv[2]
if (!checkName) throw new Error('probe name required')

async function request(base, path, init = {}) {
  const response = await fetch(new URL(path, `${base}/`), {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  })
  const text = await response.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch {}
  return { response, body, text }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = {
  'frontend-release': async () => {
    const { response, body } = await request(FRONTEND, '/release.json')
    assert(response.status === 200, `HTTP ${response.status}`)
    assert(body?.release_contract === 'paper-certification-2026-08-15', 'release contract mismatch')
    assert(body?.backend_url === BACKEND, 'backend URL mismatch')
    assert(body?.trading_mode === 'paper' && body?.network === 'testnet', 'frontend mode mismatch')
    assert(body?.live_trading_enabled === false && body?.withdrawals_enabled === false && body?.real_funds_enabled === false, 'frontend safety lock mismatch')
  },
  'worker-health': async () => {
    const { response, body } = await request(BACKEND, '/healthz')
    assert(response.status === 200, `HTTP ${response.status}`)
    assert(body?.status === 'ok', `status=${body?.status ?? 'missing'}`)
  },
  'worker-runtime': async () => {
    const { response, body } = await request(BACKEND, '/runtime/status')
    assert(response.status === 200, `HTTP ${response.status}`)
    assert(body?.trading_mode === 'paper', 'trading mode not paper')
    assert(body?.exchange_mode === 'paper', 'exchange mode not paper')
    assert(body?.network === 'testnet', 'network not testnet')
    assert(body?.allow_mainnet === false && body?.live_trading_enabled === false && body?.withdrawals_enabled === false, 'runtime safety lock mismatch')
  },
  'worker-v2': async () => {
    const { response, body } = await request(BACKEND, '/v2/infrastructure/status')
    assert(response.status === 200, `HTTP ${response.status}`)
    assert(body?.version === '2.0', 'v2 version missing')
    assert(body?.runtime?.trading_mode === 'paper', 'v2 trading mode not paper')
    assert(body?.runtime?.allow_mainnet === false && body?.runtime?.live_trading_enabled === false && body?.runtime?.withdrawals_enabled === false, 'v2 safety lock mismatch')
  },
  'worker-agent-context': async () => {
    const { response, body } = await request(BACKEND, '/agent/context')
    assert([200, 207].includes(response.status), `HTTP ${response.status}`)
    assert(body?.certification_mode === true, 'certification mode false')
    assert(body?.trading_mode === 'paper' && body?.network === 'testnet', 'agent mode mismatch')
    assert(body?.allow_mainnet === false && body?.provider_mutation_enabled === false && body?.real_funds_enabled === false && body?.withdrawals_enabled === false, 'agent safety lock mismatch')
  },
  'worker-memory-auth': async () => {
    const { response } = await request(BACKEND, '/agent/memory/release-auth-probe')
    assert(response.status === 401, `HTTP ${response.status}`)
  },
  'worker-d1-auth': async () => {
    const { response } = await request(BACKEND, '/d1/query/readonly', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT 1 AS ok' }) })
    assert(response.status === 401, `HTTP ${response.status}`)
  },
  'worker-block-live-intent': async () => {
    const { response } = await request(BACKEND, '/intent/live', { method: 'POST' })
    assert(response.status === 403, `HTTP ${response.status}`)
  },
  'worker-block-live-order': async () => {
    const { response } = await request(BACKEND, '/live/order', { method: 'POST' })
    assert(response.status === 403, `HTTP ${response.status}`)
  },
  'worker-block-withdraw': async () => {
    const { response } = await request(BACKEND, '/withdraw', { method: 'POST' })
    assert(response.status === 403, `HTTP ${response.status}`)
  },
}

const fn = checks[checkName]
if (!fn) throw new Error(`unknown probe: ${checkName}`)
await fn()
console.log(`PASS ${checkName}`)
