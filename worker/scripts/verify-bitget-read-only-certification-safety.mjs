import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const harness = fs.readFileSync(
  path.join(repoRoot, 'worker/src/live/bitget-read-only-certification.ts'),
  'utf8',
)
const entrypoint = fs.readFileSync(
  path.join(repoRoot, 'worker/src/index_live_candidate.ts'),
  'utf8',
)
const failures = []

function requireToken(token, message) {
  if (!harness.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['BitgetReadOnlyCertificationClient', 'injected certification client contract is missing'],
  ['verifyReadOnlyPermissions()', 'read-only permission verification is missing'],
  ['READ_ONLY_PERMISSIONS', 'permission evidence check is missing'],
  ['PRODUCT_CONTRACT', 'product contract check is missing'],
  ['BALANCE_CONTRACT', 'balance contract check is missing'],
  ['CURRENT_ORDER_CONTRACT', 'current-order contract check is missing'],
  ['ORDER_HISTORY_CONTRACT', 'order-history contract check is missing'],
  ['FILL_CONTRACT', 'fill contract check is missing'],
  ['PAGINATION_BOUNDARY', 'pagination boundary check is missing'],
  ['RECOVERY_IDENTITY_CONSISTENCY', 'identity consistency check is missing'],
  ['saturated_page_requires_continuation_evidence', 'saturated-page blocking is missing'],
  ['conflicting_provider_identity_evidence', 'conflicting identity rejection is missing'],
  ['certifiedForLive: false', 'live-certification lock is missing'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
  ['transferAllowed: false', 'transfer lock is missing'],
  ['withdrawalAllowed: false', 'withdrawal lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
  ['credentialsPersisted: false', 'credential persistence lock is missing'],
  ['canonicalHash', 'deterministic evidence hashing is missing'],
]) requireToken(token, message)

for (const forbidden of [
  'new BitgetReadOnlyClient(',
  'BitgetSecretProvider',
  'BitgetSecretMaterial',
  'apiKey:',
  'secretKey:',
  'passphrase:',
  'fetch(',
  'createOrder(',
  'cancelOrder(',
  'replaceOrder(',
  'requestWithdrawal(',
  'submitPlaceOrder(',
  'submitCancelOrder(',
  'submitCancelReplaceOrder(',
  'certifiedForLive: true',
  'providerMutationAllowed: true',
  'automaticRetryAllowed: true',
  'transferAllowed: true',
  'withdrawalAllowed: true',
  'executionAllowed: true',
  'credentialsPersisted: true',
]) {
  if (harness.includes(forbidden)) {
    failures.push(`forbidden read-only certification capability detected: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/bitget/read-only/certify')
  || entrypoint.includes('/certification/bitget')
  || entrypoint.includes('/provider-certification')
) {
  failures.push('Bitget read-only certification harness must not be publicly routed')
}

if (failures.length > 0) {
  console.error('Bitget read-only certification safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget read-only certification safety verification passed.')
