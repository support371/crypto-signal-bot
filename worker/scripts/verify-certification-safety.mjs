import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function requirePattern(content, pattern, message, failures) {
  if (!pattern.test(content)) failures.push(message)
}

const failures = []
const certification = read('worker/src/live/certification.ts')
const observability = read('worker/src/live/observability.ts')
const observabilityStore = read('worker/src/live/observability-store.ts')
const certificationMigration = read('worker/migrations/013_live_certification.sql')
const observabilityMigration = read('worker/migrations/012_live_observability.sql')
const liveEntrypoint = read('worker/src/index_live_candidate.ts')
const withdrawalEntrypoint = read('worker/src/index_withdrawals_candidate.ts')

requirePattern(certification, /certifiedForLive:\s*false/, 'certification evaluator must never activate candidate', failures)
requirePattern(certification, /rollback_rehearsal_passed/, 'rollback certification check is missing', failures)
requirePattern(certification, /disaster_recovery_rehearsal_passed/, 'disaster-recovery certification check is missing', failures)
requirePattern(certification, /ambiguous_submission_recovery_passed/, 'ambiguous-submission certification check is missing', failures)
requirePattern(certification, /withdrawal_candidate_lock_passed/, 'withdrawal candidate lock certification is missing', failures)
requirePattern(observability, /RELEASE_DEPLOYMENT_MISMATCH/, 'release mismatch alert is missing', failures)
requirePattern(observability, /LEDGER_IMBALANCE_DETECTED/, 'ledger imbalance alert is missing', failures)
requirePattern(observability, /USER_STREAM_STALE/, 'user stream stale alert is missing', failures)
requirePattern(observability, /HALT_WITHDRAWALS/, 'withdrawal-specific Guardian action is missing', failures)
requirePattern(observabilityStore, /ON CONFLICT\(exchange_account_id, alert_key\)/, 'alert deduplication is missing', failures)
requirePattern(observabilityStore, /live_alert_events/, 'immutable alert event persistence is missing', failures)
requirePattern(certificationMigration, /live_certification_checks/, 'certification check table is missing', failures)
requirePattern(certificationMigration, /live_certification_events_no_update/, 'certification event immutability is missing', failures)
requirePattern(observabilityMigration, /live_alert_events_no_update/, 'alert event immutability is missing', failures)
requirePattern(liveEntrypoint, /LIVE_CANDIDATE_READ_ONLY/, 'live candidate execution lock is missing', failures)
requirePattern(withdrawalEntrypoint, /WITHDRAWAL_CANDIDATE_READ_ONLY/, 'withdrawal candidate execution lock is missing', failures)

if (failures.length > 0) {
  console.error('Certification safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Certification safety verification passed.')
