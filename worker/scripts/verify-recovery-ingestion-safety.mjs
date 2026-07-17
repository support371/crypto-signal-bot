import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const failures = []
const plan = read('worker/src/live/recovery-ingestion.ts')
const store = read('worker/src/live/recovery-ingestion-store.ts')
const migration = read('worker/migrations/017_live_recovery_ingestion.sql')
const entrypoint = read('worker/src/index_live_candidate.ts')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['buildBitgetRecoveryIngestionPlan', 'Bitget recovery ingestion plan is missing'],
  ['validateRecoveryLocks', 'recovery capability-lock validation is missing'],
  ['every recovered fill must have one accounting task intent', 'fill/task cardinality guard is missing'],
  ["status: 'PENDING_ACCOUNTING'", 'pending accounting task intent is missing'],
  ['accountingApplied: false', 'ingestion accounting lock is missing'],
  ['reservationSettled: false', 'ingestion reservation lock is missing'],
  ['providerMutationAllowed: false', 'ingestion provider mutation lock is missing'],
  ['executionAllowed: false', 'ingestion execution lock is missing'],
  ['ingestionHash', 'ingestion evidence hash is missing'],
]) {
  requireToken(plan, token, message)
}

for (const [token, message] of [
  ['persistBitgetRecoveryIngestion', 'recovery ingestion store is missing'],
  ['classifyFill', 'overlapping fill classification is missing'],
  ['recovered fill and accounting task are not paired', 'fill/task pairing quarantine is missing'],
  ['recovered fill hash conflicts', 'fill hash conflict quarantine is missing'],
  ["status !== 'PENDING_ACCOUNTING'", 'existing task pending-state verification is missing'],
  ['INSERT INTO live_recovery_ingestions', 'recovery ingestion receipt insertion is missing'],
  ['INSERT INTO live_recovery_order_observations', 'recovery order evidence insertion is missing'],
  ['INSERT INTO live_recovery_fill_observations', 'recovery fill evidence insertion is missing'],
  ['INSERT INTO live_recovery_accounting_task_intents', 'accounting task intent insertion is missing'],
  ['INSERT INTO live_recovery_ingestion_events', 'append-only ingestion event is missing'],
  ['env.DB.batch(statements)', 'single D1 ingestion batch is missing'],
  ['accountingApplied: false', 'store accounting lock is missing'],
  ['reservationSettled: false', 'store reservation lock is missing'],
  ['providerMutationAllowed: false', 'store provider mutation lock is missing'],
  ['executionAllowed: false', 'store execution lock is missing'],
]) {
  requireToken(store, token, message)
}

for (const [token, message] of [
  ['live_recovery_ingestions', 'recovery ingestion table is missing'],
  ['live_recovery_order_observations', 'recovery order observation table is missing'],
  ['live_recovery_fill_observations', 'recovery fill observation table is missing'],
  ['live_recovery_accounting_task_intents', 'recovery accounting task table is missing'],
  ['live_recovery_ingestion_events', 'recovery event table is missing'],
  ["CHECK (status = 'PENDING_ACCOUNTING')", 'task intent must remain pending-only in migration 017'],
  ['CHECK (accounting_applied = 0)', 'migration accounting lock is missing'],
  ['CHECK (reservation_settled = 0)', 'migration reservation lock is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'migration provider mutation lock is missing'],
  ['CHECK (execution_allowed = 0)', 'migration execution lock is missing'],
  ['live_recovery_ingestions_no_update', 'ingestion immutability trigger is missing'],
  ['live_recovery_fill_observations_no_update', 'fill evidence immutability trigger is missing'],
  ['live_recovery_accounting_task_intents_no_update', 'task intent immutability trigger is missing'],
  ['live_recovery_ingestion_events_no_update', 'ingestion event immutability trigger is missing'],
]) {
  requireToken(migration, token, message)
}

for (const forbidden of [
  'accountSpotFillFifo',
  'persistSpotFillAccounting',
  'persistReservationSettlement',
  'UPDATE live_recovery_accounting_task_intents',
  'createOrder',
  'cancelOrder',
  'replaceOrder',
  'requestWithdrawal',
  'accountingApplied: true',
  'reservationSettled: true',
  'providerMutationAllowed: true',
  'executionAllowed: true',
]) {
  if (plan.includes(forbidden) || store.includes(forbidden)) {
    failures.push(`forbidden recovery-ingestion capability detected: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/recovery/ingest')
  || entrypoint.includes('/recovery/accounting-tasks')
  || entrypoint.includes('/recovery/snapshots')
) {
  failures.push('recovery ingestion must not be publicly exposed by the live candidate Worker')
}

if (failures.length > 0) {
  console.error('Recovery ingestion safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Recovery ingestion safety verification passed.')
