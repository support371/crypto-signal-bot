import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const store = fs.readFileSync(
  path.join(repoRoot, 'worker/src/live/bitget-read-only-certification-store.ts'),
  'utf8',
)
const migration = fs.readFileSync(
  path.join(repoRoot, 'worker/migrations/021_live_bitget_read_only_certification.sql'),
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
  ['persistBitgetReadOnlyCertification', 'certification persistence function is missing'],
  ['expectedEvidenceHash', 'evidence hash recomputation is missing'],
  ['exactly eight checks', 'mandatory eight-check validation is missing'],
  ['await env.DB.batch(statements)', 'run and check evidence must use one D1 batch'],
  ['assertRunCompatible', 'run replay verification is missing'],
  ['assertChecksCompatible', 'check replay verification is missing'],
  ['PROJECTED', 'projected persistence status is missing'],
  ['REPLAYED', 'replay persistence status is missing'],
  ['certifiedForLive: false', 'stored live certification lock is missing'],
  ['providerMutationAllowed: false', 'stored provider mutation lock is missing'],
  ['automaticRetryAllowed: false', 'stored automatic retry lock is missing'],
  ['transferAllowed: false', 'stored transfer lock is missing'],
  ['withdrawalAllowed: false', 'stored withdrawal lock is missing'],
  ['executionAllowed: false', 'stored execution lock is missing'],
  ['credentialsPersisted: false', 'stored credential persistence lock is missing'],
]) requireToken(store, token, message)

for (const [token, message] of [
  ['-- Migration 021:', 'read-only certification migration number is missing'],
  ['live_bitget_read_only_certification_runs', 'certification run table is missing'],
  ['live_bitget_read_only_certification_checks', 'certification check table is missing'],
  ["CHECK (provider = 'BITGET')", 'Bitget-only provider constraint is missing'],
  ['CHECK (certified_for_live = 0)', 'database live certification lock is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'database provider mutation lock is missing'],
  ['CHECK (automatic_retry_allowed = 0)', 'database automatic retry lock is missing'],
  ['CHECK (transfer_allowed = 0)', 'database transfer lock is missing'],
  ['CHECK (withdrawal_allowed = 0)', 'database withdrawal lock is missing'],
  ['CHECK (execution_allowed = 0)', 'database execution lock is missing'],
  ['CHECK (credentials_persisted = 0)', 'database credential lock is missing'],
  ['live_bitget_read_only_certification_runs_no_update', 'run update protection is missing'],
  ['live_bitget_read_only_certification_runs_no_delete', 'run delete protection is missing'],
  ['live_bitget_read_only_certification_checks_no_update', 'check update protection is missing'],
  ['live_bitget_read_only_certification_checks_no_delete', 'check delete protection is missing'],
]) requireToken(migration, token, message)

requireToken(
  packageJson,
  '021_live_bitget_read_only_certification.sql',
  'migration 021 local command is missing',
)

for (const forbidden of [
  'api_key',
  'secret_key',
  'passphrase',
  'raw_balance',
  'raw_order',
  'raw_fill',
  'certified_for_live = 1',
  'provider_mutation_allowed = 1',
  'automatic_retry_allowed = 1',
  'transfer_allowed = 1',
  'withdrawal_allowed = 1',
  'execution_allowed = 1',
  'credentials_persisted = 1',
]) {
  if (migration.toLowerCase().includes(forbidden)) {
    failures.push(`forbidden certification persistence field or capability: ${forbidden}`)
  }
}

for (const forbidden of [
  'createOrder(',
  'cancelOrder(',
  'replaceOrder(',
  'requestWithdrawal(',
  'fetch(',
  'certifiedForLive: true',
  'providerMutationAllowed: true',
  'automaticRetryAllowed: true',
  'transferAllowed: true',
  'withdrawalAllowed: true',
  'executionAllowed: true',
  'credentialsPersisted: true',
]) {
  if (store.includes(forbidden)) {
    failures.push(`forbidden certification store capability: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/bitget/read-only/certification/evidence')
  || entrypoint.includes('/certification/bitget/persist')
) {
  failures.push('Bitget certification persistence must not be publicly routed')
}

if (failures.length > 0) {
  console.error('Bitget read-only certification persistence verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget read-only certification persistence verification passed.')
