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
const storePath = 'worker/src/live/adapters/bitget/demo-certification-evidence-store.ts'
const runnerPath = 'worker/src/live/adapters/bitget/demo-certification-runner.ts'
const migrationPath = 'worker/migrations/026_live_bitget_demo_certification_evidence.sql'
const store = read(storePath)
const runner = read(runnerPath)
const migration = read(migrationPath)
const packageJson = read('worker/package.json')
const migrationVerifier = read('worker/scripts/verify-live-candidate-migrations.mjs')

function requireToken(source, token, message) {
  if (!source.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['recordBitgetDemoControlVerification(', 'fresh-control persistence function is missing'],
  ['assertFreshBitgetDemoControlEvidenceVerified(verified)', 'persistence must recheck the private fresh-control brand'],
  ['claimBitgetDemoReadOnlyRecoveryAttempt(', 'one-shot recovery claim function is missing'],
  ['persistBitgetDemoReadOnlyRecoveryReceipt(', 'recovery receipt persistence function is missing'],
  ['canonicalHash({', 'certification evidence must be hash-bound'],
  ['CONTROL_VERIFICATION_REQUIRES_CLAIM', 'fresh controls must require an immutable dispatch claim'],
  ['RECOVERY_ATTEMPT_ALREADY_CLAIMED', 'recovery attempts must reject automatic replay'],
  ["controlReceipt('REPLAYED'", 'exact fresh-control receipt replay must be explicit'],
  ["recoveryReceiptProjection('REPLAYED'", 'exact recovery receipt replay must be explicit'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
  ['liveExecutionAllowed: false', 'live execution lock is missing'],
  ['realFundsAllowed: false', 'real-funds lock is missing'],
  ['mainnetAllowed: false', 'mainnet lock is missing'],
  ['withdrawalsAllowed: false', 'withdrawal lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
  ['accountingAutomaticallyDispatched: false', 'automatic accounting dispatch lock is missing'],
]) {
  requireToken(store, token, message)
}

for (const [token, message] of [
  ['live_bitget_demo_control_verifications', 'fresh-control verification table is missing'],
  ['live_bitget_demo_recovery_attempts', 'read-only recovery attempt table is missing'],
  ['live_bitget_demo_recovery_receipts', 'read-only recovery receipt table is missing'],
  ['live_bitget_demo_result_requires_control_verification', 'result must require fresh-control evidence'],
  ['live_bitget_demo_recovery_attempt_requires_result', 'recovery attempt must require an ambiguous result'],
  ['live_bitget_demo_recovery_receipt_requires_attempt', 'receipt must require a one-shot attempt'],
  ['live_bitget_demo_control_verifications_no_update', 'fresh-control evidence update trigger is missing'],
  ['live_bitget_demo_control_verifications_no_delete', 'fresh-control evidence delete trigger is missing'],
  ['live_bitget_demo_recovery_attempts_no_update', 'recovery-attempt update trigger is missing'],
  ['live_bitget_demo_recovery_attempts_no_delete', 'recovery-attempt delete trigger is missing'],
  ['live_bitget_demo_recovery_receipts_no_update', 'recovery-receipt update trigger is missing'],
  ['live_bitget_demo_recovery_receipts_no_delete', 'recovery-receipt delete trigger is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'provider-mutation zero constraint is missing'],
  ['CHECK (execution_allowed = 0)', 'execution zero constraint is missing'],
  ['CHECK (live_execution_allowed = 0)', 'live execution zero constraint is missing'],
  ['CHECK (real_funds_allowed = 0)', 'real-funds zero constraint is missing'],
  ['CHECK (mainnet_allowed = 0)', 'mainnet zero constraint is missing'],
  ['CHECK (withdrawals_allowed = 0)', 'withdrawal zero constraint is missing'],
  ['CHECK (automatically_retried = 0)', 'automatic-retry zero constraint is missing'],
  ['CHECK (accounting_automatically_dispatched = 0)', 'automatic-accounting zero constraint is missing'],
]) {
  requireToken(migration, token, message)
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW|DEMO)_(?:API|SECRET|PASSPHRASE)/,
  /SecretsStore/i,
  /globalThis\.fetch/,
  /\bfetch\s*\(/,
  /\bsetTimeout\s*\(/,
  /\bsetInterval\s*\(/,
  /\bconsole\./,
  /\bUPDATE\s+live_bitget_demo_/i,
  /\bDELETE\s+FROM\s+live_bitget_demo_/i,
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /accountingAutomaticallyDispatched:\s*true/,
]) {
  if (pattern.test(store)) {
    failures.push(`forbidden certification-evidence capability detected: ${pattern}`)
  }
}

for (const sourcePath of sourceFiles('worker/src')) {
  if (sourcePath === storePath || sourcePath === runnerPath) continue
  if (/demo-certification-evidence-store\.ts/.test(read(sourcePath))) {
    failures.push(`${sourcePath} must not import source-only Bitget certification evidence`)
  }
}

if (!runner.includes('recordBitgetDemoControlVerification(')) {
  failures.push('runner does not persist fresh-control verification')
}
if (!runner.includes('claimBitgetDemoReadOnlyRecoveryAttempt(')) {
  failures.push('runner does not claim read-only recovery before calling it')
}
if (!runner.includes('persistBitgetDemoReadOnlyRecoveryReceipt(')) {
  failures.push('runner does not persist verified read-only recovery receipts')
}
if (!packageJson.includes('verify-bitget-demo-certification-evidence-safety.mjs')) {
  failures.push('certification evidence verifier is not wired into the Worker safety chain')
}
if (!packageJson.includes('026_live_bitget_demo_certification_evidence.sql')) {
  failures.push('migration 026 local command is not wired')
}
if (!migrationVerifier.includes("sequence <= 26")) {
  failures.push('migration verifier does not cover migration 026')
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  if (/demo-certification-evidence-store|BITGET_DEMO_CERTIFICATION_EVIDENCE/i.test(read(configPath))) {
    failures.push(`${configPath} must not bind source-only certification evidence`)
  }
}

if (failures.length > 0) {
  console.error('Bitget demo certification-evidence safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo certification-evidence safety verification passed.')
