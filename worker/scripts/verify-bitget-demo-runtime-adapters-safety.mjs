import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const modulePath = 'worker/src/live/adapters/bitget/demo-runtime-adapters.ts'
const moduleSource = fs.readFileSync(path.join(repoRoot, modulePath), 'utf8')
const packageJson = fs.readFileSync(path.join(repoRoot, 'worker/package.json'), 'utf8')
const failures = []

for (const [token, message] of [
  ['createBitgetDemoCallbackCredentialProvider', 'callback-scoped credential adapter is missing'],
  ['source.withLease(accountId', 'credential material must come from an injected lease source'],
  ['callbackCount !== 1', 'credential lease must be one-shot'],
  ['createVerifiedBitgetDemoFreshControlLoader', 'fresh-control adapter is missing'],
  ['verifyFreshBitgetDemoControlEvidence(', 'fresh controls must be reverified by the private-brand verifier'],
  ['BitgetDemoRateLimitDurableObject', 'source-only Durable Object rate authority is missing'],
  ['new BitgetDemoDurableRateLimitAuthority({', 'Durable Object must reuse the reviewed sliding-window authority'],
  ['createBitgetDemoDurableRateLimitAuthorityProvider', 'namespace rate-authority provider is missing'],
  ["stub.fetch('https://bitget-demo-rate.internal/claim'", 'rate claims must use the account-scoped Durable Object stub'],
  ['createBitgetDemoGetOnlyRecoveryBoundary', 'GET-only recovery boundary is missing'],
  ["lookup.method !== 'GET'", 'recovery must reject non-GET lookups'],
  ['accountingAutomaticallyDispatched: false', 'recovery must not dispatch accounting'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
  ['liveExecutionAllowed: false', 'live execution lock is missing'],
  ['realFundsAllowed: false', 'real-funds lock is missing'],
  ['mainnetAllowed: false', 'mainnet lock is missing'],
  ['withdrawalsAllowed: false', 'withdrawal lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
]) {
  if (!moduleSource.includes(token)) failures.push(message)
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /SecretsStore/i,
  /globalThis\.fetch/,
  /\?\?\s*fetch\b/,
  /(^|[^\w.])fetch\s*\(/m,
  /\bconsole\./,
  /JSON\.stringify\s*\(\s*(?:material|apiKey|secretKey|passphrase)/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /accountingAutomaticallyDispatched:\s*true/,
]) {
  if (pattern.test(moduleSource)) {
    failures.push(`forbidden demo runtime-adapter capability detected: ${pattern}`)
  }
}

for (const entrypoint of [
  'worker/src/index.ts',
  'worker/src/index_live_candidate.ts',
  'worker/src/index_withdrawals_candidate.ts',
  'worker/src/index_bitget_trade_quarantine.ts',
]) {
  const absolute = path.join(repoRoot, entrypoint)
  if (fs.existsSync(absolute) && /demo-runtime-adapters/.test(fs.readFileSync(absolute, 'utf8'))) {
    failures.push(`${entrypoint} must not import the source-only demo runtime adapters`)
  }
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  const source = fs.readFileSync(path.join(repoRoot, configPath), 'utf8')
  if (/BitgetDemoRateLimitDurableObject|BITGET_DEMO_RUNTIME_ADAPTER/i.test(source)) {
    failures.push(`${configPath} must not bind the source-only demo runtime adapters`)
  }
}

if (!packageJson.includes('live-bitget-demo-runtime-adapters.test.ts')) {
  failures.push('demo runtime-adapter tests are not wired into provider validation')
}
if (!packageJson.includes('verify-bitget-demo-runtime-adapters-safety.mjs')) {
  failures.push('demo runtime-adapter verifier is not wired into the Worker safety chain')
}

if (failures.length > 0) {
  console.error('Bitget demo runtime-adapter safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo runtime-adapter safety verification passed.')
