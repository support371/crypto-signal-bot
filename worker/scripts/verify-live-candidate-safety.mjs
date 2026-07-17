import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function requirePattern(content, pattern, message, failures) {
  if (!pattern.test(content)) failures.push(message)
}

const failures = []
const config = read('wrangler.live-candidate.toml')
const entrypoint = read('worker/src/index_live_candidate.ts')
const releaseGate = read('worker/src/live/release-gate.ts')
const coordinator = read('worker/src/live/account-coordinator.ts')
const decimal = read('worker/src/live/decimal.ts')
const idempotency = read('worker/src/live/idempotency.ts')
const idempotencyMigration = read('worker/migrations/004_live_idempotency_records.sql')

requirePattern(config, /TRADING_MODE\s*=\s*"live-candidate"/, 'candidate trading mode is not explicit', failures)
requirePattern(config, /NETWORK\s*=\s*"testnet"/, 'candidate network must default to testnet', failures)
requirePattern(config, /ALLOW_MAINNET\s*=\s*"false"/, 'ALLOW_MAINNET must default false', failures)
requirePattern(config, /LIVE_EXECUTION_ENABLED\s*=\s*"false"/, 'live execution must default false', failures)
requirePattern(config, /WITHDRAWALS_ENABLED\s*=\s*"false"/, 'withdrawals must default false', failures)
requirePattern(config, /CANDIDATE_RESOURCES_CONFIGURED\s*=\s*"false"/, 'candidate resources must default unconfigured', failures)
requirePattern(config, /database_name\s*=\s*"crypto-signal-bot-live-candidate-db"/, 'candidate D1 database is not isolated', failures)
requirePattern(config, /database_id\s*=\s*"00000000-0000-0000-0000-000000000000"/, 'candidate D1 placeholder lock is missing', failures)
requirePattern(config, /bucket_name\s*=\s*"crypto-signal-bot-live-candidate-storage"/, 'candidate R2 bucket is not isolated', failures)
requirePattern(config, /name\s*=\s*"EXCHANGE_ACCOUNT_COORDINATOR"/, 'Durable Object binding is missing', failures)
requirePattern(config, /new_sqlite_classes\s*=\s*\["ExchangeAccountCoordinator"\]/, 'SQLite Durable Object migration is missing', failures)

for (const pathName of [
  '/intent/live',
  '/withdraw',
  '/live/order',
  '/live/trade',
  '/orders',
  '/order',
]) {
  if (!entrypoint.includes(`'${pathName}'`)) {
    failures.push(`missing blocked financial path: ${pathName}`)
  }
}

requirePattern(entrypoint, /pathname\.startsWith\('\/v1\/orders'\)/, 'versioned order mutations are not blocked', failures)
requirePattern(entrypoint, /pathname\.startsWith\('\/v1\/withdrawals'\)/, 'versioned withdrawal mutations are not blocked', failures)
requirePattern(entrypoint, /if \(!SAFE_METHODS\.has\(method\)\)/, 'candidate does not block general mutations', failures)
requirePattern(entrypoint, /export \{ ExchangeAccountCoordinator \}/, 'candidate does not export the Durable Object coordinator', failures)
requirePattern(releaseGate, /liveReady:\s*false/, 'candidate readiness must never report live-ready', failures)
requirePattern(releaseGate, /withdrawalsReady:\s*false/, 'candidate readiness must never report withdrawals-ready', failures)
requirePattern(releaseGate, /candidate_build_cannot_execute_live_orders/, 'candidate execution lock reason missing', failures)
requirePattern(coordinator, /LIVE_CANDIDATE_EXECUTION_LOCKED/, 'account coordinator execution lock is missing', failures)
requirePattern(coordinator, /return json\([\s\S]*423\)/, 'account coordinator must reject mutations with HTTP 423', failures)
requirePattern(decimal, /BigInt|bigint/, 'exact decimal arithmetic must be BigInt-backed', failures)
requirePattern(decimal, /quantizeDown/, 'exchange-increment quantization primitive is missing', failures)
requirePattern(idempotency, /INSERT OR IGNORE INTO idempotency_records/, 'atomic idempotency claim is missing', failures)
requirePattern(idempotency, /request_hash/, 'idempotency request fingerprint is missing', failures)
requirePattern(idempotencyMigration, /PRIMARY KEY \(operation_scope, idempotency_key\)/, 'idempotency uniqueness constraint is missing', failures)
requirePattern(idempotencyMigration, /RECOVERY_REQUIRED/, 'idempotency recovery status is missing', failures)

const productionIdentifiers = [
  'd647c639-845a-414e-9bb4-513e42ef4451',
  'crypto-signal-bot-storage',
  '8f0321c43b844ec08c514f1d04839a3c',
]
for (const identifier of productionIdentifiers) {
  if (config.includes(identifier)) {
    failures.push(`production resource identifier leaked into candidate config: ${identifier}`)
  }
}

const forbiddenSecretAssignments = /(API_KEY|API_SECRET|PRIVATE_KEY|PASSPHRASE)\s*=\s*"[^"\s]+"/i
if (forbiddenSecretAssignments.test(config)) {
  failures.push('plaintext secret-like value found in live candidate config')
}

if (/\[triggers\]/.test(config) || /crons\s*=/.test(config)) {
  failures.push('live candidate must not have scheduled triggers')
}

if (failures.length > 0) {
  console.error('Live candidate safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Live candidate safety verification passed.')
