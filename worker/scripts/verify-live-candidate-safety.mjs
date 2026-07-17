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

requirePattern(config, /TRADING_MODE\s*=\s*"live-candidate"/, 'candidate trading mode is not explicit', failures)
requirePattern(config, /NETWORK\s*=\s*"testnet"/, 'candidate network must default to testnet', failures)
requirePattern(config, /ALLOW_MAINNET\s*=\s*"false"/, 'ALLOW_MAINNET must default false', failures)
requirePattern(config, /LIVE_EXECUTION_ENABLED\s*=\s*"false"/, 'live execution must default false', failures)
requirePattern(config, /WITHDRAWALS_ENABLED\s*=\s*"false"/, 'withdrawals must default false', failures)

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
requirePattern(releaseGate, /liveReady:\s*false/, 'candidate readiness must never report live-ready', failures)
requirePattern(releaseGate, /withdrawalsReady:\s*false/, 'candidate readiness must never report withdrawals-ready', failures)
requirePattern(releaseGate, /candidate_build_cannot_execute_live_orders/, 'candidate execution lock reason missing', failures)

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
