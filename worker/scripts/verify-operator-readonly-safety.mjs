import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const auth = await readFile(new URL('../src/live/operator-read-auth.ts', import.meta.url), 'utf8')
const model = await readFile(new URL('../src/live/operator-read-model.ts', import.meta.url), 'utf8')
const deploymentModel = await readFile(
  new URL('../src/live/operator-deployment-readiness-read-model.ts', import.meta.url),
  'utf8',
)
const entrypoint = await readFile(new URL('../src/index_live_candidate.ts', import.meta.url), 'utf8')
const combined = `${auth}\n${model}\n${deploymentModel}`

for (const required of [
  'OPERATOR_API_KEY_HASHES',
  'X-Operator-Id',
  "crypto.subtle.digest('SHA-256'",
  'constantTimeHexEqual',
  'FROM live_actor_roles',
  "scopeType === 'GLOBAL'",
  "scopeType === 'EXCHANGE'",
  'exchangeAccountId',
  "'DEPLOYMENT_READINESS'",
  "status: 'NOT_CONFIGURED'",
  "status: 'UNAUTHENTICATED'",
  "status: 'FORBIDDEN'",
]) {
  assert.ok(auth.includes(required), `operator auth must include ${required}`)
}

for (const required of [
  'live_bitget_read_only_certification_runs',
  'live_bitget_read_only_certification_checks',
  'live_bitget_read_only_certification_attestations',
  'live_bitget_attested_recovery_readiness',
  'live_fill_accounting_reconciliations',
  'live_alerts',
  'immutable_audit_events',
]) {
  assert.ok(model.includes(required), `operator read model must query ${required}`)
}

for (const required of [
  'live_bitget_demo_deployment_readiness_manifests',
  'ORDER BY prepared_at DESC, created_at DESC',
  'capabilityLocksValid',
  'stored_capability_lock_violation',
  'externalReadOnlyAttestationPresent',
  'readyForNonLiveDeploymentReview',
  'deploymentAllowed: false',
  'demoRequestAllowed: false',
  'credentialsRead: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
]) {
  assert.ok(
    deploymentModel.includes(required),
    `deployment readiness read model must include ${required}`,
  )
}

for (const forbidden of [
  'manifestId:',
  'manifestHash:',
  'externalAttestationId:',
  'evidenceHashes:',
  'preparedBy:',
]) {
  assert.ok(
    !deploymentModel.includes(forbidden),
    `deployment readiness response must not expose ${forbidden}`,
  )
}

for (const required of [
  '/v1/operator/activation-gate',
  '/v1/operator/deployment-readiness',
  '/v1/operator/certification',
  '/v1/operator/recovery-readiness',
  '/v1/operator/reconciliation',
  '/v1/operator/alerts',
  '/v1/operator/audit-head',
  "resource === 'DEPLOYMENT_READINESS'",
  'readLatestBitgetDemoDeploymentReadiness',
  "method !== 'GET' && method !== 'HEAD'",
  'Operator mutation routes are disabled',
  'activationEnabled: false',
  'activationBlocked: true',
  'realMoneyMovementAllowed: false',
  'deploymentAllowed: false',
  'demoRequestAllowed: false',
  'credentialsRead: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'withdrawalsAllowed: false',
]) {
  assert.ok(entrypoint.includes(required), `live candidate operator routes must include ${required}`)
}

for (const forbidden of [
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+[a-z_]/i,
  /\bDELETE\s+FROM\b/i,
  /\.run\s*\(/,
  /\.batch\s*\(/,
  /\bfetch\s*\(/,
  /signing/i,
  /private[_-]?key/i,
  /passphrase/i,
  /secret[_-]?provider/i,
  /order_json/i,
  /fill_json/i,
  /before_json/i,
  /after_json/i,
  /live_balance_snapshots/i,
  /guardian.*(?:halt|reset)\s*\(/i,
]) {
  assert.doesNotMatch(combined, forbidden, `operator read modules must not match ${forbidden}`)
}

for (const forbidden of [
  'providerMutationAllowed: true',
  'executionAllowed: true',
  'withdrawalsAllowed: true',
  'activationEnabled: true',
  'deploymentAllowed: true',
  'demoRequestAllowed: true',
  'credentialsRead: true',
  "'Access-Control-Allow-Methods': 'GET, POST",
]) {
  assert.ok(!entrypoint.includes(forbidden), `live candidate operator routes must forbid ${forbidden}`)
}

console.log('operator read-only safety verified')
