import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const sourcePath = 'worker/src/live/adapters/bitget/demo-control-binding-store.ts'
const migrationPath = 'worker/migrations/027_live_bitget_demo_control_bindings.sql'
const source = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8')
const migration = fs.readFileSync(path.join(repoRoot, migrationPath), 'utf8')
const packageJson = fs.readFileSync(path.join(repoRoot, 'worker/package.json'), 'utf8')
const failures = []

for (const [content, token, message] of [
  [migration, 'live_bitget_demo_place_control_bindings', 'migration-027 control-binding table is missing'],
  [migration, "CHECK (operation = 'PLACE')", 'control binding must be place-only'],
  [migration, 'guardian_reviewed_state_hash', 'reviewed Guardian state hash is missing'],
  [migration, 'idempotency_operation_id', 'durable idempotency mapping is missing'],
  [migration, 'live_bitget_demo_place_control_bindings_no_update', 'immutable update trigger is missing'],
  [migration, 'live_bitget_demo_place_control_bindings_no_delete', 'immutable delete trigger is missing'],
  [source, 'loadReviewedBitgetDemoDispatchAuthorization(', 'reviewed authorization must be reloaded'],
  [source, 'await assertBitgetDemoCandidateIntegrity(candidate)', 'candidate hash and locks must be reverified'],
  [source, "candidate.operation !== 'PLACE'", 'non-place candidates must be rejected'],
  [source, "row.status !== 'READY_BUT_EXECUTION_LOCKED'", 'assessment must remain execution-locked'],
  [source, 'FROM live_guardian_states', 'Guardian state must be freshly reloaded'],
  [source, "row.status !== 'CLEAR'", 'Guardian non-clear state must fail closed'],
  [source, 'FROM idempotency_records', 'idempotency record must be freshly reloaded'],
  [source, "row.status !== 'CLAIMED'", 'completed or failed idempotency must be rejected'],
  [source, 'MAX_RISK_AGE_MS = 2_000', 'fresh-risk maximum age is missing'],
  [source, 'guardianEvidenceHash !== authorization.guardianEvidenceHash', 'Guardian authorization hash comparison is missing'],
  [source, 'riskEvidenceHash !== authorization.riskEvidenceHash', 'risk authorization hash comparison is missing'],
  [source, 'idempotencyEvidenceHash !== authorization.idempotencyEvidenceHash', 'idempotency authorization hash comparison is missing'],
  [source, 'sources.guardianStateHash !== reviewed.guardianReviewedStateHash', 'Guardian drift rejection is missing'],
  [source, 'sources.risk.hash !== reviewed.riskDecisionHash', 'risk drift rejection is missing'],
  [source, 'sources.idempotencyKeyHash !== reviewed.idempotencyKeyHash', 'idempotency drift rejection is missing'],
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
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /accountingAutomaticallyDispatched:\s*true/,
]) {
  if (pattern.test(source)) failures.push(`forbidden control-binding capability detected: ${pattern}`)
}

for (const pattern of [
  /provider_mutation_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /execution_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /live_execution_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /real_funds_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /mainnet_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /withdrawals_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /automatic_retry_allowed\s+INTEGER[^\n]*DEFAULT\s+1/i,
  /accounting_automatically_dispatched\s+INTEGER[^\n]*DEFAULT\s+1/i,
]) {
  if (pattern.test(migration)) failures.push(`migration-027 capability lock is unsafe: ${pattern}`)
}

for (const entrypoint of [
  'worker/src/index.ts',
  'worker/src/index_live_candidate.ts',
  'worker/src/index_withdrawals_candidate.ts',
  'worker/src/index_bitget_trade_quarantine.ts',
]) {
  const absolute = path.join(repoRoot, entrypoint)
  if (fs.existsSync(absolute) && /demo-control-binding-store/.test(fs.readFileSync(absolute, 'utf8'))) {
    failures.push(`${entrypoint} must not import the source-only control-binding store`)
  }
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  if (/demo-control-binding|BITGET_DEMO_CONTROL/i.test(fs.readFileSync(path.join(repoRoot, configPath), 'utf8'))) {
    failures.push(`${configPath} must not bind the source-only control-binding store`)
  }
}

if (!packageJson.includes('live-bitget-demo-control-binding-store.test.ts')) {
  failures.push('control-binding tests are not wired into provider validation')
}
if (!packageJson.includes('verify-bitget-demo-control-binding-safety.mjs')) {
  failures.push('control-binding verifier is not wired into the Worker safety chain')
}
if (!packageJson.includes('migrate:027:local')) {
  failures.push('migration 027 local command is missing')
}

if (failures.length > 0) {
  console.error('Bitget demo control-binding safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo control-binding safety verification passed.')
