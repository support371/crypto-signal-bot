import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const failures = []
const plan = read('worker/src/live/reservation-settlement.ts')
const store = read('worker/src/live/reservation-settlement-store.ts')
const migration = read('worker/migrations/016_live_reservation_settlement.sql')
const entrypoint = read('worker/src/index_live_candidate.ts')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['buildReservationSettlementPlan', 'reservation settlement plan is missing'],
  ['validateBalancedJournal', 'fill journal balance verification is missing'],
  ["balanced.eventType !== 'SPOT_FILL_POSTED'", 'fill journal event-type binding is missing'],
  ["entry.direction !== 'CREDIT'", 'reservation consumption must be derived from reserved credits only'],
  ['sumDecimals', 'exact multi-entry reservation consumption is missing'],
  ['fill settlement exceeds reserved amount', 'reservation over-consumption guard is missing'],
  ['buildReservationReleaseJournal', 'terminal remainder release journal is missing'],
  ["nextStatus = 'RELEASED'", 'terminal release state is missing'],
  ["nextStatus = 'CONSUMED'", 'fully consumed state is missing'],
  ["nextStatus = 'PARTIALLY_CONSUMED'", 'partial consumption state is missing'],
  ['settlementHash', 'settlement evidence hash is missing'],
  ['reservationStateUpdated: false', 'pure plan must not mutate reservation state'],
  ['releaseJournalPosted: false', 'pure plan must not post release journal'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
]) {
  requireToken(plan, token, message)
}

for (const [token, message] of [
  ['persistReservationSettlement', 'transactional settlement store is missing'],
  ['live_fill_accounting_receipts', 'immutable fill accounting binding is missing'],
  ['provider_mutation_allowed', 'fill accounting provider lock verification is missing'],
  ['reservation_applied', 'fill accounting reservation lock verification is missing'],
  ['execution_allowed', 'fill accounting execution lock verification is missing'],
  ['loadFillJournal', 'posted fill journal reconstruction is missing'],
  ['buildReservationSettlementPlan', 'settlement plan integration is missing'],
  ['UPDATE reservations', 'optimistic reservation update is missing'],
  ['AND consumed_amount = ?', 'consumed amount compare-and-set is missing'],
  ['AND status = ?', 'reservation status compare-and-set is missing'],
  ['AND version = ?', 'reservation version compare-and-set is missing'],
  ['INSERT INTO live_reservation_settlement_receipts', 'immutable settlement receipt insertion is missing'],
  ['INSERT INTO live_reservation_settlement_events', 'append-only settlement event insertion is missing'],
  ['env.DB.batch(statements)', 'single transactional settlement batch is missing'],
  ['request_hash', 'settlement replay request hash is missing'],
  ['reservationStateUpdated: true', 'successful internal state update evidence is missing'],
  ['providerMutationAllowed: false', 'store provider mutation lock is missing'],
  ['executionAllowed: false', 'store execution lock is missing'],
]) {
  requireToken(store, token, message)
}

for (const [token, message] of [
  ['ADD COLUMN version INTEGER NOT NULL DEFAULT 0', 'reservation version column is missing'],
  ['request_hash TEXT NOT NULL', 'settlement request hash column is missing'],
  ['next_version INTEGER NOT NULL CHECK (next_version = previous_version + 1)', 'monotonic settlement version constraint is missing'],
  ['idx_live_reservation_settlement_version_claim', 'unique reservation version claim is missing'],
  ['ON live_reservation_settlement_receipts(reservation_id, next_version)', 'reservation version uniqueness columns are missing'],
  ['reservation_state_updated INTEGER NOT NULL DEFAULT 1', 'reservation state evidence constraint is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'migration provider mutation lock is missing'],
  ['CHECK (execution_allowed = 0)', 'migration execution lock is missing'],
  ['live_reservation_settlement_verify_state', 'post-update reservation verification trigger is missing'],
  ['reservation settlement state verification failed', 'reservation verification failure is missing'],
  ['live_reservation_settlement_receipts_no_update', 'settlement receipt immutability is missing'],
  ['live_reservation_settlement_events_no_update', 'settlement event immutability is missing'],
]) {
  requireToken(migration, token, message)
}

for (const forbidden of [
  'createOrder',
  'cancelOrder',
  'replaceOrder',
  'requestWithdrawal',
  'providerMutationAllowed: true',
  'executionAllowed: true',
]) {
  if (plan.includes(forbidden) || store.includes(forbidden)) {
    failures.push(`forbidden reservation-settlement capability detected: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/reservation-settlement')
  || entrypoint.includes('/settle-reservation')
  || entrypoint.includes('/release-reservation')
) {
  failures.push('reservation settlement must not be publicly exposed by the live candidate Worker')
}

if (failures.length > 0) {
  console.error('Reservation settlement safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Reservation settlement safety verification passed.')
