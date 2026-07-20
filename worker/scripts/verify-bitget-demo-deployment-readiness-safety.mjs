import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const sourcePath = 'worker/src/live/adapters/bitget/demo-deployment-readiness.ts'
const migrationPath = 'worker/migrations/028_live_bitget_demo_deployment_readiness.sql'
const source = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8')
const migration = fs.readFileSync(path.join(repoRoot, migrationPath), 'utf8')
const packageJson = fs.readFileSync(path.join(repoRoot, 'worker/package.json'), 'utf8')
const failures = []

for (const [content, token, message] of [
  [migration, 'live_bitget_demo_deployment_readiness_manifests', 'migration-028 readiness table is missing'],
  [migration, "status IN ('BLOCKED', 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW')", 'readiness status constraint is missing'],
  [migration, 'check_count = 14', 'fourteen-check constraint is missing'],
  [migration, 'live_bitget_demo_deployment_readiness_no_update', 'immutable update trigger is missing'],
  [migration, 'live_bitget_demo_deployment_readiness_no_delete', 'immutable delete trigger is missing'],
  [source, 'BITGET_DEMO_DEPLOYMENT_EVIDENCE_KEYS', 'required evidence-key registry is missing'],
  [source, "name: 'EXACT_GIT_SHA'", 'exact Git SHA check is missing'],
  [source, "name: 'EXTERNAL_READ_ONLY_ATTESTATION'", 'external attestation check is missing'],
  [source, "row.source_mode === 'ISOLATED_READ_ONLY_CLIENT'", 'isolated-client attestation requirement is missing'],
  [source, "row.run_status === 'PASSED'", 'passed read-only run requirement is missing'],
  [source, 'row.passed_check_count === 8', 'eight passing provider checks are required'],
  [source, 'row.total_check_count === 8', 'exact provider check count is required'],
  [source, 'readyForNonLiveDeploymentReview: ready', 'review-only readiness result is missing'],
  [source, "status: ready ? 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'", 'ready status derivation is missing'],
  [source, 'deploymentAllowed: false', 'deployment lock is missing'],
  [source, 'demoRequestAllowed: false', 'demo-request lock is missing'],
  [source, 'credentialsRead: false', 'credential-read lock is missing'],
  [source, 'credentialsPersisted: false', 'credential persistence lock is missing'],
  [source, 'providerMutationAllowed: false', 'provider mutation lock is missing'],
  [source, 'executionAllowed: false', 'execution lock is missing'],
  [source, 'liveExecutionAllowed: false', 'live execution lock is missing'],
  [source, 'realFundsAllowed: false', 'real-funds lock is missing'],
  [source, 'mainnetAllowed: false', 'mainnet lock is missing'],
  [source, 'withdrawalsAllowed: false', 'withdrawal lock is missing'],
  [source, 'automaticRetryAllowed: false', 'automatic retry lock is missing'],
  [source, 'accountingAutomaticallyDispatched: false', 'automatic accounting lock is missing'],
]) {
  if (!content.includes(token)) failures.push(message)
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /SecretsStore/i,
  /ACCESS-(?:KEY|SIGN|TIMESTAMP|PASSPHRASE)/,
  /signBitgetPrehash/,
  /globalThis\.fetch/,
  /\bfetch\s*\(/,
  /\bconsole\./,
  /deploymentAllowed:\s*true/,
  /demoRequestAllowed:\s*true/,
  /credentialsRead:\s*true/,
  /credentialsPersisted:\s*true/,
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /accountingAutomaticallyDispatched:\s*true/,
]) {
  if (pattern.test(source)) failures.push(`forbidden readiness capability detected: ${pattern}`)
}

for (const pattern of [
  /deployment_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /demo_request_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /credentials_read\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /credentials_persisted\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /provider_mutation_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /execution_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /live_execution_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /real_funds_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /mainnet_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /withdrawals_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /automatic_retry_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /accounting_automatically_dispatched\s+INTEGER[^\n]*DEFAULT\s+1/i,
]) {
  if (pattern.test(migration)) failures.push(`migration-028 capability lock is unsafe: ${pattern}`)
}

for (const entrypoint of [
  'worker/src/index.ts',
  'worker/src/index_live_candidate.ts',
  'worker/src/index_withdrawals_candidate.ts',
  'worker/src/index_bitget_trade_quarantine.ts',
]) {
  const absolute = path.join(repoRoot, entrypoint)
  if (fs.existsSync(absolute) && /demo-deployment-readiness/.test(fs.readFileSync(absolute, 'utf8'))) {
    failures.push(`${entrypoint} must not import the source-only readiness manifest`)
  }
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  if (/demo-deployment-readiness|BITGET_DEMO_DEPLOYMENT/i.test(fs.readFileSync(path.join(repoRoot, configPath), 'utf8'))) {
    failures.push(`${configPath} must not bind the source-only readiness manifest`)
  }
}

if (!packageJson.includes('live-bitget-demo-deployment-readiness.test.ts')) {
  failures.push('readiness tests are not wired into provider validation')
}
if (!packageJson.includes('verify-bitget-demo-deployment-readiness-safety.mjs')) {
  failures.push('readiness verifier is not wired into the Worker safety chain')
}
if (!packageJson.includes('migrate:028:local')) {
  failures.push('migration 028 local command is missing')
}

if (failures.length > 0) {
  console.error('Bitget demo deployment-readiness safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo deployment-readiness safety verification passed.')
