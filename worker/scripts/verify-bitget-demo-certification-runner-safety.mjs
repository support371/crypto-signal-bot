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
const modulePath = 'worker/src/live/adapters/bitget/demo-certification-runner.ts'
const certificationStorePath = 'worker/src/live/adapters/bitget/demo-certification-evidence-store.ts'
const runtimeAdapterPath = 'worker/src/live/adapters/bitget/demo-runtime-adapters.ts'
const controlBindingStorePath = 'worker/src/live/adapters/bitget/demo-control-binding-store.ts'
const compositionPath = 'worker/src/live/adapters/bitget/demo-certification-composition.ts'
const runner = read(modulePath)
const packageJson = read('worker/package.json')

function requireToken(token, message) {
  if (!runner.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['Object.defineProperty(verified, VERIFIED_FRESH_CONTROL_EVIDENCE', 'fresh control brand must use an explicit property descriptor'],
  ['enumerable: false', 'fresh control brand must be non-enumerable'],
  ['freshControlEvidenceLoader.load(', 'Guardian/risk/idempotency evidence must be freshly reloaded'],
  ['const { reloadedAt: _reloadedAt, ...binding } = evidence', 'trusted reload time must not make the stable authorization binding self-expiring'],
  ['bitgetDemoControlEvidenceBindingHash(input.guardian)', 'Guardian evidence must be re-hashed'],
  ['bitgetDemoControlEvidenceBindingHash(input.risk)', 'risk evidence must be re-hashed'],
  ['bitgetDemoControlEvidenceBindingHash(input.idempotency)', 'idempotency evidence must be re-hashed'],
  ['assertFreshBitgetDemoControlEvidenceVerified(verified)', 'fresh control brand must be checked before credential use'],
  ['verificationRecorder.record(', 'fresh control verification must be persisted before credential use'],
  ['rateLimitAuthorityProvider.forAccount(', 'account-scoped rate authority must be selected'],
  ['new BitgetDemoWriteTransport({', 'reviewed bounded demo transport must be composed'],
  ['fetcher: dependencies.fetcher', 'demo fetcher must be injected'],
  ['credentialProvider.withDemoSigningMaterial(', 'signing material must be callback-scoped and injected'],
  ['materialUseCount !== 1', 'signing material callback must be one-shot'],
  ['return transport.dispatch(candidate, authorization, material)', 'demo transport must receive callback-scoped material directly'],
  ['orchestrateReviewedBitgetDemoDispatch(', 'immutable reviewed one-shot orchestration must be composed'],
  ['claimBitgetDemoReadOnlyRecoveryAttempt(', 'ambiguous recovery must be claimed durably before a read-only call'],
  ['recoverReviewedBitgetDemoDispatch(', 'ambiguous results must use the read-only recovery boundary'],
  ['persistBitgetDemoReadOnlyRecoveryReceipt(', 'read-only recovery receipts must be persisted immutably'],
  ['outcome.persistence.resultHash !== await canonicalHash(outcome.result)', 'persisted result hash must be reverified before recovery'],
  ['accountingAutomaticallyDispatched: false', 'read-only recovery must not dispatch accounting automatically'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
  ['liveExecutionAllowed: false', 'live execution lock is missing'],
  ['realFundsAllowed: false', 'real-funds lock is missing'],
  ['mainnetAllowed: false', 'mainnet lock is missing'],
  ['withdrawalsAllowed: false', 'withdrawal lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
]) {
  requireToken(token, message)
}

const loaderPosition = runner.indexOf('freshControlEvidenceLoader.load(')
const persistencePosition = runner.indexOf('verificationRecorder.record(')
const credentialPosition = runner.indexOf('credentialProvider.withDemoSigningMaterial(')
const transportPosition = runner.indexOf('return transport.dispatch(candidate, authorization, material)')
if (
  loaderPosition < 0
  || persistencePosition < 0
  || credentialPosition < 0
  || transportPosition < 0
  || loaderPosition >= credentialPosition
  || loaderPosition >= persistencePosition
  || persistencePosition >= credentialPosition
  || credentialPosition >= transportPosition
) {
  failures.push('fresh controls, callback-scoped credentials, and demo transport are in the wrong order')
}

const orchestrationPosition = runner.lastIndexOf('orchestrateReviewedBitgetDemoDispatch(')
const recoveryClaimPosition = runner.lastIndexOf('claimBitgetDemoReadOnlyRecoveryAttempt(')
const recoveryPosition = runner.lastIndexOf('recoverReviewedBitgetDemoDispatch(')
const recoveryPersistencePosition = runner.lastIndexOf('persistBitgetDemoReadOnlyRecoveryReceipt(')
if (
  orchestrationPosition < 0
  || recoveryClaimPosition < 0
  || recoveryPosition < 0
  || recoveryPersistencePosition < 0
  || orchestrationPosition >= recoveryClaimPosition
  || recoveryClaimPosition >= recoveryPosition
  || recoveryPosition >= recoveryPersistencePosition
) {
  failures.push('immutable result persistence must complete before read-only recovery')
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /SecretsStore/i,
  /globalThis\.fetch/,
  /\?\?\s*fetch\b/,
  /\bfetch\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(/,
  /\bconsole\./,
  /\.prepare\s*\(/,
  /\.put\s*\(/,
  /\.delete\s*\(/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /accountingAutomaticallyDispatched:\s*true/,
]) {
  if (pattern.test(runner)) {
    failures.push(`forbidden demo certification-runner capability detected: ${pattern}`)
  }
}

for (const sourcePath of sourceFiles('worker/src')) {
  if (
    sourcePath === modulePath
    || sourcePath === certificationStorePath
    || sourcePath === runtimeAdapterPath
    || sourcePath === controlBindingStorePath
    || sourcePath === compositionPath
  ) continue
  if (/demo-certification-runner\.ts/.test(read(sourcePath))) {
    failures.push(`${sourcePath} must not import the source-only demo certification runner`)
  }
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  if (/demo-certification-runner|BITGET_DEMO_RUNNER/i.test(read(configPath))) {
    failures.push(`${configPath} must not bind or configure the source-only demo certification runner`)
  }
}

if (!packageJson.includes('live-bitget-demo-certification-runner.test.ts')) {
  failures.push('demo certification-runner tests are not wired into provider validation')
}
if (!packageJson.includes('verify-bitget-demo-certification-runner-safety.mjs')) {
  failures.push('demo certification-runner verifier is not wired into the Worker safety chain')
}

if (failures.length > 0) {
  console.error('Bitget demo certification-runner safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

await import('./verify-bitget-demo-runtime-adapters-safety.mjs')
console.log('Bitget demo certification-runner safety verification passed.')
