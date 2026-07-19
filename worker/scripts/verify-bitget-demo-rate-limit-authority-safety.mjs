import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function sourceFiles(directory) {
  const absolute = path.join(repoRoot, directory)
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(relative)
    return entry.isFile() && entry.name.endsWith('.ts') ? [relative] : []
  })
}

const failures = []
const modulePath = 'worker/src/live/adapters/bitget/demo-rate-limit-authority.ts'
const runtimeAdapterPath = 'worker/src/live/adapters/bitget/demo-runtime-adapters.ts'
const authority = read(modulePath)
const packageJson = read('worker/package.json')

function requireToken(token, message) {
  if (!authority.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['implements BitgetDemoRateLimitAuthority', 'authority must implement the demo transport contract'],
  ['storage: DurableObjectStorage', 'authority must require Durable Object storage'],
  ['this.storage.transaction(async (transaction)', 'claims must be serialized in one Durable Object transaction'],
  ["WINDOW_STATE_PREFIX = 'bitget-demo-rate-window:'", 'account window state prefix is missing'],
  ["RECEIPT_PREFIX = 'bitget-demo-rate-receipt:'", 'immutable attempt receipt prefix is missing'],
  ['timestamp > cutoff', 'sliding-window cutoff must be strict'],
  ['active.length < claim.maximumRequests', 'endpoint ceiling check is missing'],
  ['BITGET_DEMO_WRITE_CONTRACT.requestLimitsPerSecond', 'reviewed endpoint ceilings must be reused'],
  ['BITGET_MUTATION_EVIDENCE_ENDPOINTS.placeOrder', 'place endpoint binding is missing'],
  ['BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelOrder', 'cancel endpoint binding is missing'],
  ['BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelReplaceOrder', 'cancel-replace endpoint binding is missing'],
  ['await canonicalHash(base) !== stateHash', 'stored sliding-window integrity verification is missing'],
  ['await canonicalHash(base) !== receiptHash', 'stored receipt integrity verification is missing'],
  ['verifyStoredReceipt(existing, claim)', 'idempotent receipt replay verification is missing'],
  ['observedCountBefore: active.length', 'pre-claim count evidence is missing'],
  ['observedCountAfter: nextTimestamps.length', 'post-claim count evidence is missing'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['liveExecutionAllowed: false', 'live execution lock is missing'],
  ['realFundsAllowed: false', 'real-funds lock is missing'],
  ['mainnetAllowed: false', 'mainnet lock is missing'],
  ['withdrawalsAllowed: false', 'withdrawal lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
]) {
  requireToken(token, message)
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /SecretsStore/i,
  /secretProvider/i,
  /\bfetch\s*\(/,
  /globalThis\.fetch/,
  /ACCESS-(?:KEY|SIGN|TIMESTAMP|PASSPHRASE)/,
  /signBitgetPrehash/,
  /crypto\.subtle/,
  /\bD1Database\b/,
  /\bR2Bucket\b/,
  /\bKVNamespace\b/,
  /\.deleteAll\s*\(/,
  /transaction\.delete\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bconsole\./,
  /providerMutationAllowed:\s*true/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
]) {
  if (pattern.test(authority)) failures.push(`forbidden demo rate-limit capability detected: ${pattern}`)
}

for (const sourcePath of sourceFiles('worker/src')) {
  if (sourcePath === modulePath || sourcePath === runtimeAdapterPath) continue
  if (/demo-rate-limit-authority\.ts/.test(read(sourcePath))) {
    failures.push(`${sourcePath} must not import the isolated demo rate-limit authority`)
  }
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  if (/demo-rate-limit-authority|BITGET_DEMO_RATE/i.test(read(configPath))) {
    failures.push(`${configPath} must not bind or configure the isolated demo rate limiter`)
  }
}

if (!packageJson.includes('live-bitget-demo-rate-limit-authority.test.ts')) {
  failures.push('demo rate-limit tests are not wired into provider validation')
}
if (!packageJson.includes('verify-bitget-demo-rate-limit-authority-safety.mjs')) {
  failures.push('demo rate-limit verifier is not wired into the Worker safety chain')
}

if (failures.length > 0) {
  console.error('Bitget demo rate-limit authority safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo rate-limit authority safety verification passed.')
