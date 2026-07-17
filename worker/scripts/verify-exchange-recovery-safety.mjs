import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const failures = []
const bitgetStream = read('worker/src/live/adapters/bitget/user-stream.ts')
const bitgetRecovery = read('worker/src/live/adapters/bitget/recovery.ts')
const bitgetClient = read('worker/src/live/adapters/bitget/read-only-client.ts')
const btccRecovery = read('worker/src/live/adapters/btcc/recovery.ts')
const btccContract = read('worker/src/live/adapters/btcc/contract.ts')
const entrypoint = read('worker/src/index_live_candidate.ts')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['initial_rest_snapshot_required', 'Bitget initial REST recovery requirement is missing'],
  ['rest_snapshot_required_after_connect', 'Bitget connect recovery boundary is missing'],
  ['websocket_disconnected', 'Bitget disconnect recovery boundary is missing'],
  ['server_timestamp_regression', 'Bitget timestamp regression guard is missing'],
  ['conflicting_stream_identity:', 'Bitget conflicting identity recovery is missing'],
  ['multiple fee assets require REST recovery', 'Bitget multi-fee ambiguity guard is missing'],
  ['MAX_RECENT_FINGERPRINTS = 256', 'Bitget stream fingerprint bound is missing'],
  ["input === 'pong'", 'Bitget pong handling is missing'],
  ['bitget_stream_pong_stale', 'Bitget pong freshness guard is missing'],
  ['ordersSubscribed', 'Bitget orders subscription state is missing'],
  ['fillsSubscribed', 'Bitget fills subscription state is missing'],
  ['REST_SNAPSHOT_REQUIRED', 'Bitget fail-closed recovery action is missing'],
  ['providerMutationAllowed', 'Bitget recovery mutation lock evidence is missing'],
  ['executionAllowed', 'Bitget recovery execution lock evidence is missing'],
]) {
  requireToken(bitgetStream, token, message)
}

for (const [token, message] of [
  ['BitgetReadOnlyRecoveryClient', 'Bitget REST recovery client is missing'],
  ['listCurrentOrders', 'Bitget current-order recovery read is missing'],
  ['listHistoryOrders', 'Bitget order-history recovery read is missing'],
  ['listFills', 'Bitget fill recovery read is missing'],
  ['MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000', 'Bitget ninety-day recovery bound is missing'],
  ['MAX_LIMIT = 100', 'Bitget page-size bound is missing'],
  ['pagination is required before recovery', 'Bitget saturated-page failure is missing'],
  ['conflicting order snapshot at identical update time', 'Bitget conflicting order recovery is missing'],
  ['conflicting fill snapshot', 'Bitget conflicting fill recovery is missing'],
  ['providerMutationAllowed: false', 'Bitget REST provider mutation lock is missing'],
  ['executionAllowed: false', 'Bitget REST execution lock is missing'],
]) {
  requireToken(bitgetRecovery, token, message)
}

for (const [token, message] of [
  ['validateBtccRecoveryManifest', 'BTCC recovery manifest validation is missing'],
  ['validateBtccReadOnlyManifest', 'BTCC recovery must delegate to the base manifest validator'],
  ["'active_orders_snapshot'", 'BTCC active-orders capability is missing'],
  ["'order_history_snapshot'", 'BTCC order-history capability is missing'],
  ["'fill_history_snapshot'", 'BTCC fill-history capability is missing'],
  ['BTCC recovery capability is missing from the reviewed manifest', 'BTCC missing-capability lock is absent'],
  ['endpointSchemaImported: true', 'BTCC recovery contract must prove an imported manifest'],
  ['BTCC recovery snapshot must be complete', 'BTCC complete-snapshot guard is missing'],
  ['BTCC recovery snapshot must be bounded', 'BTCC bounded-snapshot guard is missing'],
  ['manifestSha256', 'BTCC recovery manifest hash binding is missing'],
  ['officialGuideRevision', 'BTCC guide revision binding is missing'],
  ['providerMutationAllowed: false', 'BTCC provider mutation lock is missing'],
  ['executionAllowed: false', 'BTCC execution lock is missing'],
]) {
  requireToken(btccRecovery, token, message)
}

for (const [token, message] of [
  ['endpointSchemaImported: false', 'BTCC provider must remain manifest-unavailable by default'],
  ['readOnlyManifestRequired: true', 'BTCC read-only manifest requirement is missing'],
  ["endpoint.method !== 'GET'", 'BTCC base manifest GET-only guard is missing'],
]) {
  requireToken(btccContract, token, message)
}

for (const [token, message] of [
  ["assertBitgetReadOnlyRequest('GET', endpoint)", 'Bitget transport GET-only guard is missing'],
  ["method: 'GET'", 'Bitget transport request method is not fixed to GET'],
]) {
  requireToken(bitgetClient, token, message)
}

const forbiddenCapabilityTokens = [
  'createOrder',
  'cancelOrder',
  'replaceOrder',
  'requestWithdrawal',
  'providerMutationAllowed: true',
  'executionAllowed: true',
]
for (const forbidden of forbiddenCapabilityTokens) {
  if (
    bitgetStream.includes(forbidden)
    || bitgetRecovery.includes(forbidden)
    || btccRecovery.includes(forbidden)
  ) {
    failures.push(`forbidden exchange recovery capability detected: ${forbidden}`)
  }
}

const hardcodedBtccNetworkPatterns = [
  /https:\/\/[^'"`\s]*btcc/i,
  /wss:\/\/[^'"`\s]*btcc/i,
  /\/api\/[a-z0-9/_-]*btcc/i,
]
for (const pattern of hardcodedBtccNetworkPatterns) {
  if (pattern.test(btccRecovery)) {
    failures.push(`BTCC recovery contains a guessed network endpoint: ${pattern}`)
  }
}

if (
  entrypoint.includes('/bitget/recovery')
  || entrypoint.includes('/btcc/recovery')
  || entrypoint.includes('/user-stream/recovery')
) {
  failures.push('exchange recovery must not be publicly exposed by the live candidate Worker')
}

if (failures.length > 0) {
  console.error('Exchange recovery safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Exchange recovery safety verification passed.')
