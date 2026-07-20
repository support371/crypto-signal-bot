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
const storePath = 'worker/src/live/adapters/bitget/demo-dispatch-evidence-store.ts'
const orchestratorPath = 'worker/src/live/adapters/bitget/demo-dispatch-orchestrator.ts'
const runnerPath = 'worker/src/live/adapters/bitget/demo-certification-runner.ts'
const certificationStorePath = 'worker/src/live/adapters/bitget/demo-certification-evidence-store.ts'
const controlBindingStorePath = 'worker/src/live/adapters/bitget/demo-control-binding-store.ts'
const compositionPath = 'worker/src/live/adapters/bitget/demo-certification-composition.ts'
const deploymentReadinessPath = 'worker/src/live/adapters/bitget/demo-deployment-readiness.ts'
const migrationPath = 'worker/migrations/025_live_bitget_demo_dispatch_evidence.sql'
const allowedSourceImporters = new Set([
  orchestratorPath,
  runnerPath,
  certificationStorePath,
  controlBindingStorePath,
  compositionPath,
  deploymentReadinessPath,
])
const store = read(storePath)
const orchestrator = read(orchestratorPath)
const migration = read(migrationPath)
const packageJson = read('worker/package.json')
const combined = `${store}\n${orchestrator}`

function requireToken(source, token, message) {
  if (!source.includes(token)) failures.push(message)
}

for (const [source, token, message] of [
  [store, 'FROM live_authorization_events authorization', 'authorization must reload immutable authorization evidence'],
  [store, "row.action !== REVIEW_ACTION", 'authorization action binding is missing'],
  [store, "row.resource_type !== REVIEW_RESOURCE_TYPE", 'candidate resource binding is missing'],
  [store, "row.decision !== 'ALLOW'", 'allow-decision verification is missing'],
  [store, "row.assurance_level !== 'AAL2'", 'operations step-up assurance verification is missing'],
  [store, "actorRoles.includes('RISK_OPERATOR')", 'risk-role verification is missing'],
  [store, 'assertBitgetDemoDispatchAuthorizationVerified', 'private in-memory authorization brand must be rechecked'],
  [store, 'expectedAuthorizationHash', 'authorization evidence hash verification is missing'],
  [store, 'claimReviewedBitgetDemoDispatchAttempt', 'one-shot dispatch claim is missing'],
  [store, 'already durably claimed and cannot be retried', 'durable replay rejection is missing'],
  [store, 'await env.DB.batch(statements)', 'result and recovery evidence must persist in one D1 batch'],
  [store, 'resultJson = canonicalJson(result)', 'exact result evidence serialization is missing'],
  [store, 'resultHash = await canonicalHash(result)', 'result evidence hashing is missing'],
  [orchestrator, 'executor.serializer.run(', 'account-scoped serialization is missing'],
  [orchestrator, 'claimReviewedBitgetDemoDispatchAttempt(', 'orchestrator must claim before dispatch'],
  [orchestrator, 'const result = await executor.dispatch(', 'reviewed injected dispatch boundary is missing'],
  [orchestrator, 'persistBitgetDemoDispatchResult(', 'immutable result persistence is missing'],
  [migration, 'live_bitget_demo_dispatch_authorizations', 'migration authorization table is missing'],
  [migration, 'live_bitget_demo_dispatch_claims', 'migration one-shot claim table is missing'],
  [migration, 'live_bitget_demo_dispatch_results', 'migration result table is missing'],
  [migration, 'live_bitget_demo_dispatch_recovery_requirements', 'migration recovery requirements table is missing'],
  [migration, 'live_bitget_demo_claim_requires_exact_authorization', 'claim-to-authorization trigger is missing'],
  [migration, 'live_bitget_demo_result_requires_exact_claim', 'result-to-claim trigger is missing'],
  [migration, 'live_bitget_demo_results_no_delete', 'immutable result deletion guard is missing'],
]) {
  requireToken(source, token, message)
}

const claimPosition = orchestrator.indexOf('claimReviewedBitgetDemoDispatchAttempt(')
const dispatchPosition = orchestrator.indexOf('const result = await executor.dispatch(')
if (claimPosition < 0 || dispatchPosition < 0 || claimPosition >= dispatchPosition) {
  failures.push('one-shot durable claim must occur before the injected dispatch call')
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /SecretsStore/i,
  /secretProvider/i,
  /signBitgetPrehash/,
  /ACCESS-(?:KEY|SIGN|TIMESTAMP|PASSPHRASE)/,
  /\bfetch\s*\(/,
  /globalThis\.fetch/,
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(/,
  /\.delete\s*\(/,
  /\bconsole\./,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /automaticallyRetried:\s*true/,
  /realProviderMutationAllowed:\s*true/,
]) {
  if (pattern.test(combined)) {
    failures.push(`forbidden demo dispatch evidence capability detected: ${pattern}`)
  }
}

for (const pattern of [
  /live_execution_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /real_funds_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /mainnet_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /withdrawals_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /automatically_retried\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /real_provider_mutation_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
]) {
  if (pattern.test(migration)) failures.push(`migration capability lock is unsafe: ${pattern}`)
}

for (const sourcePath of sourceFiles('worker/src')) {
  if (sourcePath === storePath || allowedSourceImporters.has(sourcePath)) continue
  if (/demo-dispatch-evidence-store\.ts|demo-dispatch-orchestrator\.ts/.test(read(sourcePath))) {
    failures.push(`${sourcePath} must not import source-only Bitget demo dispatch evidence`)
  }
}

for (const sourcePath of sourceFiles('worker/src')) {
  if (sourcePath === storePath) continue
  if (/demo-dispatch-evidence-store\.ts/.test(read(sourcePath)) && !allowedSourceImporters.has(sourcePath)) {
    failures.push(`${sourcePath} is not an approved source-only evidence-store importer`)
  }
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  if (/demo-dispatch|BITGET_DEMO_DISPATCH/i.test(read(configPath))) {
    failures.push(`${configPath} must not bind or configure source-only demo dispatch evidence`)
  }
}

if (!packageJson.includes('live-bitget-demo-dispatch-evidence.test.ts')) {
  failures.push('demo dispatch evidence tests are not wired into provider validation')
}
if (!packageJson.includes('live-bitget-demo-dispatch-evidence-sqlite.test.ts')) {
  failures.push('demo dispatch SQLite integration test is not wired into provider validation')
}
if (!packageJson.includes('verify-bitget-demo-dispatch-evidence-safety.mjs')) {
  failures.push('demo dispatch evidence verifier is not wired into the Worker safety chain')
}

if (failures.length > 0) {
  console.error('Bitget demo dispatch evidence safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo dispatch evidence safety verification passed.')
