import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const files = {
  migration: 'worker/migrations/029_live_bitget_demo_operational_rehearsals.sql',
  evaluator: 'worker/src/live/demo-operational-rehearsal.ts',
  store: 'worker/src/live/demo-operational-rehearsal-store.ts',
  reader: 'worker/src/live/operator-operational-rehearsal-read-model.ts',
  router: 'worker/src/live/operator-read-http.ts',
  auth: 'worker/src/live/operator-read-auth.ts',
}
const source = Object.fromEntries(Object.entries(files).map(([key, value]) => [
  key,
  fs.readFileSync(path.join(repoRoot, value), 'utf8'),
]))
const packageJson = fs.readFileSync(path.join(repoRoot, 'worker/package.json'), 'utf8')
const failures = []

for (const [content, token, message] of [
  [source.migration, 'live_bitget_demo_operational_rehearsal_packs', 'migration-029 table is missing'],
  [source.migration, 'scenario_count = 5', 'five-scenario database constraint is missing'],
  [source.migration, 'READY_FOR_INDEPENDENT_REVIEW', 'review-only status is missing'],
  [source.migration, 'operational_rehearsal_no_update', 'append-only update trigger is missing'],
  [source.migration, 'operational_rehearsal_no_delete', 'append-only delete trigger is missing'],
  [source.evaluator, 'ROLLBACK_TO_KNOWN_GOOD', 'rollback scenario is missing'],
  [source.evaluator, 'DISASTER_RECOVERY_RESTORE', 'disaster-recovery scenario is missing'],
  [source.evaluator, 'ACCESS_REFERENCE_ROTATION', 'access-reference scenario is missing'],
  [source.evaluator, 'PROVIDER_OUTAGE_FAIL_CLOSED', 'provider-outage scenario is missing'],
  [source.evaluator, 'INCIDENT_ESCALATION_AND_CONTAINMENT', 'incident scenario is missing'],
  [source.evaluator, 'READY_FOR_INDEPENDENT_REVIEW', 'evaluator review-only status is missing'],
  [source.store, 'immutable rehearsal insert was rejected', 'immutable persistence rejection is missing'],
  [source.reader, 'stored_capability_lock_violation', 'reader corruption blocker is missing'],
  [source.router, '/v1/operator/operational-readiness', 'operator route is missing'],
  [source.router, "resource: 'OPERATIONAL_REHEARSAL'", 'operator resource response is missing'],
  [source.auth, "OPERATIONAL_REHEARSAL: ['RISK_ADMIN', 'AUDITOR', 'RELEASE_ADMIN']", 'global role restriction is missing'],
]) {
  if (!content.includes(token)) failures.push(message)
}

const combined = Object.values(source).join('\n')
for (const pattern of [
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
  /globalThis\.fetch/,
  /\bfetch\s*\(/,
  /SecretsStore/i,
  /ACCESS-(?:KEY|SIGN|TIMESTAMP|PASSPHRASE)/,
  /signBitgetPrehash/,
]) {
  if (pattern.test(combined)) failures.push(`forbidden operational capability detected: ${pattern}`)
}

for (const entrypoint of [
  'worker/src/index.ts',
  'worker/src/index_live_candidate.ts',
  'worker/src/index_withdrawals_candidate.ts',
  'worker/src/index_bitget_trade_quarantine.ts',
]) {
  const content = fs.readFileSync(path.join(repoRoot, entrypoint), 'utf8')
  if (/demo-operational-rehearsal(?:-store)?/.test(content)) {
    failures.push(`${entrypoint} must not import rehearsal mutation/evaluator modules`)
  }
}

if (!packageJson.includes('live-operational-rehearsal-evaluator.test.ts')) {
  failures.push('evaluator tests are not wired into provider validation')
}
if (!packageJson.includes('live-operational-rehearsal-store.test.ts')) {
  failures.push('store tests are not wired into provider validation')
}
if (!packageJson.includes('live-operator-operational-readiness-http.test.ts')) {
  failures.push('operator route tests are not wired into provider validation')
}
if (!packageJson.includes('verify-operational-rehearsal-safety.mjs')) {
  failures.push('operational safety verifier is not wired into the Worker safety chain')
}
if (!packageJson.includes('migrate:029:local')) {
  failures.push('migration 029 local command is missing')
}

if (failures.length > 0) {
  console.error('Operational rehearsal safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Operational rehearsal safety verification passed.')
