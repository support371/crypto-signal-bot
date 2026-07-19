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
const modulePath = 'worker/src/live/adapters/bitget/demo-write-transport.ts'
const allowedSourceImporters = new Set([
  'worker/src/live/adapters/bitget/demo-rate-limit-authority.ts',
  'worker/src/live/adapters/bitget/demo-dispatch-evidence-store.ts',
  'worker/src/live/adapters/bitget/demo-dispatch-orchestrator.ts',
  'worker/src/live/adapters/bitget/demo-certification-evidence-store.ts',
  'worker/src/live/adapters/bitget/demo-certification-runner.ts',
  'worker/src/live/adapters/bitget/demo-runtime-adapters.ts',
])
const transport = read(modulePath)
const packageJson = read('worker/package.json')
const configs = [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
].map((file) => [file, read(file)])

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ["environment: 'BITGET_DEMO'", 'transport must be hard-bound to the demo environment'],
  ["requestHeaderName: 'paptrading'", 'official Bitget demo header name is missing'],
  ["requestHeaderValue: '1'", 'official Bitget demo header value is missing'],
  ["PLACE: 10", 'place-order account rate ceiling is missing'],
  ["CANCEL: 10", 'cancel-order account rate ceiling is missing'],
  ["CANCEL_REPLACE: 5", 'cancel-replace account rate ceiling is missing'],
  ['BITGET_MUTATION_EVIDENCE_ENDPOINTS.placeOrder', 'place-order endpoint must come from the exact candidate allowlist'],
  ['BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelOrder', 'cancel-order endpoint must come from the exact candidate allowlist'],
  ['BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelReplaceOrder', 'cancel-replace endpoint must come from the exact candidate allowlist'],
  ['Object.defineProperty(authorization, VERIFIED_DEMO_AUTHORIZATION', 'authorization brand must use an explicit property descriptor'],
  ['enumerable: false', 'authorization brand must be non-enumerable'],
  ['await assertBitgetDemoCandidateIntegrity(candidate)', 'candidate evidence hash must be reverified before dispatch'],
  ['this.rateLimitAuthority.claim(rateLimitRequest)', 'account rate-limit authority must be claimed before dispatch'],
  ['options.fetcher', 'transport must require an injected fetcher'],
  ["method: 'POST'", 'demo transport must explicitly select POST'],
  ["redirect: 'error'", 'redirects must fail closed'],
  ['AbortController', 'bounded timeout controller is missing'],
  ['maxRequestBytes', 'request-size boundary is missing'],
  ['maxResponseBytes', 'response-size boundary is missing'],
  ['signBitgetPrehash', 'official HMAC signing helper is missing'],
  ["['40010', '40725', '45001']", 'certified ambiguous provider-code manifest is missing'],
  ["unknownCodePolicy: 'UNKNOWN_REQUIRES_REVIEW'", 'unknown provider codes must fail closed for review'],
  ["category: 'CANCEL_REPLACE_REQUIRES_LOOKUP'", 'cancel-replace split outcome must require lookup'],
  ['this.consumedAttemptIds.add(authorization.dispatchAttemptId)', 'dispatch attempt must be consumed before provider request'],
  ['realProviderMutationAllowed: false', 'real provider mutation lock is missing'],
  ['liveExecutionAllowed: false', 'live execution lock is missing'],
  ['realFundsAllowed: false', 'real-funds lock is missing'],
  ['mainnetAllowed: false', 'mainnet lock is missing'],
  ['withdrawalsAllowed: false', 'withdrawal lock is missing'],
  ['automaticRetryAllowed: false', 'automatic-retry lock is missing'],
]) {
  requireToken(transport, token, message)
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /SecretsStore/i,
  /secretProvider/i,
  /\benv\b/,
  /globalThis\.fetch/,
  /options\.fetcher\s*\?\?\s*fetch/,
  /\bfetch\s*\(/,
  /\bconsole\./,
  /\bD1Database\b/,
  /\bKVNamespace\b/,
  /\bR2Bucket\b/,
  /\.prepare\s*\(/,
  /\.put\s*\(/,
  /\/api\/[^'"\s]*withdraw/i,
  /realProviderMutationAllowed:\s*true/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /setTimeout\s*\([^,]+,\s*(?:[1-9]\d*)\s*\).*\bdispatch\s*\(/s,
]) {
  if (pattern.test(transport)) failures.push(`forbidden demo-transport capability detected: ${pattern}`)
}

for (const [configName, config] of configs) {
  if (/demo-write-transport|BITGET_DEMO|paptrading/i.test(config)) {
    failures.push(`${configName} must not bind or configure the isolated demo transport`)
  }
}

for (const sourcePath of sourceFiles('worker/src')) {
  if (sourcePath === modulePath) continue
  const content = read(sourcePath)
  if (/demo-write-transport\.ts/.test(content) && !allowedSourceImporters.has(sourcePath)) {
    failures.push(`${sourcePath} must not import the isolated demo write transport`)
  }
}

if (!packageJson.includes('verify-bitget-demo-write-transport-safety.mjs')) {
  failures.push('demo write-transport safety verifier is not wired into the Worker safety chain')
}
if (!packageJson.includes('live-bitget-demo-write-transport.test.ts')) {
  failures.push('demo write-transport tests are not wired into provider validation')
}

if (failures.length > 0) {
  console.error('Bitget demo write-transport safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo write-transport safety verification passed.')
