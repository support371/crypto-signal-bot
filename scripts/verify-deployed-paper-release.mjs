const DEFAULT_FRONTEND_URL = 'https://crypto-signal-bot-indol.vercel.app'
const DEFAULT_BACKEND_URL = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev'
const RELEASE_CONTRACT = 'paper-certification-2026-08-15'
const REQUEST_TIMEOUT_MS = 12_000

function readArgument(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a URL`)
  return value.replace(/\/+$/, '')
}

const frontendUrl = readArgument('--frontend', DEFAULT_FRONTEND_URL)
const backendUrl = readArgument('--backend', DEFAULT_BACKEND_URL)

async function request(baseUrl, path, init = {}) {
  const response = await fetch(new URL(path, `${baseUrl}/`), {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: 'application/json', ...(init.headers ?? {}) },
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  return { response, body, text }
}

const checks = []

async function check(name, callback) {
  try {
    const detail = await callback()
    checks.push({ name, passed: true, detail })
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    checks.push({ name, passed: false, detail })
    console.error(`FAIL ${name} — ${detail}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

await check('frontend release contract', async () => {
  const { response, body, text } = await request(frontendUrl, '/release.json')
  assert(response.status === 200, `expected HTTP 200, received ${response.status}`)
  assert(body, `expected JSON, received ${text.slice(0, 160)}`)
  assert(body.release_contract === RELEASE_CONTRACT, `unexpected release contract ${body.release_contract ?? 'missing'}`)
  assert(body.dashboard_path === '/dashboard', 'dashboard path must be /dashboard')
  assert(body.backend_url === backendUrl, `frontend points to ${body.backend_url ?? 'no backend'}`)
  assert(body.trading_mode === 'paper', 'frontend release is not paper-only')
  assert(body.network === 'testnet', 'frontend release is not testnet-bound')
  assert(body.live_trading_enabled === false, 'frontend release enables live trading')
  assert(body.withdrawals_enabled === false, 'frontend release enables withdrawals')
  assert(body.real_funds_enabled === false, 'frontend release enables real funds')
  return RELEASE_CONTRACT
})

await check('frontend dashboard route', async () => {
  const response = await fetch(new URL('/dashboard', `${frontendUrl}/`), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  const html = await response.text()
  assert(response.status === 200, `expected HTTP 200, received ${response.status}`)
  assert(html.includes('Crypto Signal Bot V2'), 'dashboard SPA shell is missing the certification title')
  return '/dashboard is reachable'
})

await check('Worker health', async () => {
  const { response, body } = await request(backendUrl, '/healthz')
  assert(response.status === 200, `expected HTTP 200, received ${response.status}`)
  assert(body?.status === 'ok', `unexpected health payload ${JSON.stringify(body)}`)
  return 'healthy'
})

await check('Worker paper runtime locks', async () => {
  const { response, body } = await request(backendUrl, '/runtime/status')
  assert(response.status === 200, `expected HTTP 200, received ${response.status}`)
  assert(body?.trading_mode === 'paper', 'trading_mode is not paper')
  assert(body?.exchange_mode === 'paper', 'exchange_mode is not paper')
  assert(body?.network === 'testnet', 'network is not testnet')
  assert(body?.allow_mainnet === false, 'mainnet is allowed')
  assert(body?.live_trading_enabled === false, 'live trading is enabled')
  assert(body?.withdrawals_enabled === false, 'withdrawals are enabled')
  return 'paper/testnet; live and withdrawals locked'
})

await check('Worker v2 infrastructure contract', async () => {
  const { response, body, text } = await request(backendUrl, '/v2/infrastructure/status')
  assert(response.status === 200, `expected HTTP 200, received ${response.status}: ${text.slice(0, 160)}`)
  assert(body?.version === '2.0', 'v2 infrastructure payload is missing')
  assert(body?.runtime?.trading_mode === 'paper', 'v2 runtime is not paper')
  assert(body?.runtime?.allow_mainnet === false, 'v2 runtime allows mainnet')
  assert(body?.runtime?.live_trading_enabled === false, 'v2 runtime enables live trading')
  assert(body?.runtime?.withdrawals_enabled === false, 'v2 runtime enables withdrawals')
  return `authority=${body?.fast_path?.authority ?? 'unknown'}`
})

await check('Worker agent context contract', async () => {
  const { response, body, text } = await request(backendUrl, '/agent/context')
  assert([200, 207].includes(response.status), `expected HTTP 200 or 207, received ${response.status}: ${text.slice(0, 160)}`)
  assert(body?.certification_mode === true, 'certification_mode is not true')
  assert(body?.trading_mode === 'paper', 'agent context is not paper')
  assert(body?.network === 'testnet', 'agent context is not testnet')
  assert(body?.allow_mainnet === false, 'agent context allows mainnet')
  assert(body?.provider_mutation_enabled === false, 'provider mutation is enabled')
  assert(body?.real_funds_enabled === false, 'real funds are enabled')
  assert(body?.withdrawals_enabled === false, 'withdrawals are enabled')
  assert(typeof body?.runtime?.status === 'string', 'rich direct-subcheck context is not deployed')
  return response.status === 200 ? 'all subchecks healthy' : 'contract current; one or more subchecks degraded'
})

await check('Worker privileged helper routes fail closed', async () => {
  const memory = await request(backendUrl, '/agent/memory/release-auth-probe')
  assert(memory.response.status === 401, `agent memory expected HTTP 401, received ${memory.response.status}`)

  const d1 = await request(backendUrl, '/d1/query/readonly', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql: 'SELECT 1 AS ok' }),
  })
  assert(d1.response.status === 401, `D1 query expected HTTP 401, received ${d1.response.status}`)
  return 'agent memory and D1 query require server credentials'
})

for (const [path, label] of [['/intent/live', 'live intent'], ['/live/order', 'live order'], ['/withdraw', 'withdrawal']]) {
  await check(`Worker blocks ${label}`, async () => {
    const { response, body } = await request(backendUrl, path, { method: 'POST' })
    assert(response.status === 403, `expected HTTP 403, received ${response.status}`)
    assert(body?.code === 403 || body?.error || body?.detail, 'blocked response is not explicit')
    return 'HTTP 403'
  })
}

const failures = checks.filter((item) => !item.passed)
if (failures.length > 0) {
  console.error(`\nDeployment verification failed: ${failures.length}/${checks.length} check(s) failed.`)
  process.exit(1)
}

console.log(`\nDeployment verification passed: ${checks.length}/${checks.length} paper-release checks.`)
