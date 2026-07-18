import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const service = fs.readFileSync(
  path.join(repoRoot, 'worker/src/live/bitget-read-only-certification-attestation.ts'),
  'utf8',
)
const migration = fs.readFileSync(
  path.join(repoRoot, 'worker/migrations/022_live_bitget_read_only_certification_attestation.sql'),
  'utf8',
)
const packageJson = fs.readFileSync(path.join(repoRoot, 'worker/package.json'), 'utf8')
const entrypoint = fs.readFileSync(
  path.join(repoRoot, 'worker/src/index_live_candidate.ts'),
  'utf8',
)
const failures = []

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ["'INJECTED_FIXTURES'", 'fixture source mode is missing'],
  ["'ISOLATED_READ_ONLY_CLIENT'", 'isolated client source mode is missing'],
  ['fixture certification evidence must remain LOCAL_TEST', 'fixture environment isolation is missing'],
  ['isolated read-only client evidence cannot use LOCAL_TEST', 'isolated environment isolation is missing'],
  ['authorizationEventHash', 'isolated authorization evidence is missing'],
  ['REQUIRED_CHECK_COUNT = 8', 'eight-check external evidence requirement is missing'],
  ['checks.some((check) => check.status !== \'PASS\')', 'passing-check requirement is missing'],
  ['externalReadOnlyEvidence: false', 'fixture non-external result is missing'],
  ['externalReadOnlyEvidence: true', 'isolated external result is missing'],
  ['certificationCheckProjectionAllowed: false', 'automatic certification projection lock is missing'],
  ['certifiedForLive: false', 'live certification lock is missing'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
  ['transferAllowed: false', 'transfer lock is missing'],
  ['withdrawalAllowed: false', 'withdrawal lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
  ['credentialsPersisted: false', 'credential persistence lock is missing'],
  ['canonicalHash', 'attestation hash binding is missing'],
]) requireToken(service, token, message)

for (const [token, message] of [
  ['-- Migration 022:', 'attestation migration number is missing'],
  ['live_bitget_read_only_certification_attestations', 'attestation table is missing'],
  ["source_mode IN ('INJECTED_FIXTURES', 'ISOLATED_READ_ONLY_CLIENT')", 'source-mode constraint is missing'],
  ["environment IN ('LOCAL_TEST', 'SHADOW', 'TESTNET', 'LIVE_CANDIDATE')", 'environment constraint is missing'],
  ["source_mode = 'INJECTED_FIXTURES'", 'fixture database branch is missing'],
  ['external_read_only_evidence = 0', 'fixture external-evidence lock is missing'],
  ["source_mode = 'ISOLATED_READ_ONLY_CLIENT'", 'isolated database branch is missing'],
  ['authorization_event_hash IS NOT NULL', 'isolated authorization hash constraint is missing'],
  ['external_read_only_evidence = 1', 'isolated external-evidence marker is missing'],
  ['CHECK (certification_check_projection_allowed = 0)', 'automatic projection database lock is missing'],
  ['CHECK (certified_for_live = 0)', 'database live certification lock is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'database provider mutation lock is missing'],
  ['CHECK (automatic_retry_allowed = 0)', 'database automatic retry lock is missing'],
  ['CHECK (transfer_allowed = 0)', 'database transfer lock is missing'],
  ['CHECK (withdrawal_allowed = 0)', 'database withdrawal lock is missing'],
  ['CHECK (execution_allowed = 0)', 'database execution lock is missing'],
  ['CHECK (credentials_persisted = 0)', 'database credential persistence lock is missing'],
  ['live_bitget_read_only_certification_attestations_no_update', 'attestation update protection is missing'],
  ['live_bitget_read_only_certification_attestations_no_delete', 'attestation delete protection is missing'],
]) requireToken(migration, token, message)

requireToken(
  packageJson,
  '022_live_bitget_read_only_certification_attestation.sql',
  'migration 022 local command is missing',
)

for (const forbidden of [
  'createOrder(',
  'cancelOrder(',
  'replaceOrder(',
  'requestWithdrawal(',
  'fetch(',
  'certificationCheckProjectionAllowed: true',
  'certifiedForLive: true',
  'providerMutationAllowed: true',
  'automaticRetryAllowed: true',
  'transferAllowed: true',
  'withdrawalAllowed: true',
  'executionAllowed: true',
  'credentialsPersisted: true',
]) {
  if (service.includes(forbidden)) {
    failures.push(`forbidden Bitget certification attestation capability: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/bitget/read-only/certification/attest')
  || entrypoint.includes('/provider-certification/attestation')
) {
  failures.push('Bitget certification attestation must not be publicly routed')
}

if (failures.length > 0) {
  console.error('Bitget read-only certification attestation verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget read-only certification attestation verification passed.')
