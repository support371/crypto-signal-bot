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
const withdrawalConfig = read('wrangler.withdrawals-candidate.toml')
const withdrawalEntrypoint = read('worker/src/index_withdrawals_candidate.ts')
const transferState = read('worker/src/live/transfer-state.ts')
const withdrawalPolicy = read('worker/src/live/withdrawal-policy.ts')
const authorization = read('worker/src/live/authorization.ts')
const guardian = read('worker/src/live/guardian.ts')
const userStream = read('worker/src/live/adapters/coinbase/user-stream.ts')
const queueContracts = read('worker/src/live/queue-contracts.ts')
const transferMigration = read('worker/migrations/011_live_transfer_lifecycle.sql')
const authorizationMigration = read('worker/migrations/010_live_authorization.sql')
const queueMigration = read('worker/migrations/009_live_queue_delivery.sql')

requirePattern(withdrawalConfig, /WITHDRAWALS_ENABLED\s*=\s*"false"/, 'withdrawals must default disabled', failures)
requirePattern(withdrawalConfig, /TRANSFER_PROVIDER_CONFIGURED\s*=\s*"false"/, 'transfer provider must default unconfigured', failures)
requirePattern(withdrawalConfig, /TRANSFER_RESOURCES_CONFIGURED\s*=\s*"false"/, 'transfer resources must default unconfigured', failures)
requirePattern(withdrawalConfig, /database_name\s*=\s*"crypto-signal-bot-withdrawals-candidate-db"/, 'withdrawal D1 is not isolated', failures)
requirePattern(withdrawalConfig, /database_id\s*=\s*"00000000-0000-0000-0000-000000000000"/, 'withdrawal D1 placeholder lock is missing', failures)
requirePattern(withdrawalConfig, /bucket_name\s*=\s*"crypto-signal-bot-withdrawals-candidate-storage"/, 'withdrawal R2 is not isolated', failures)

requirePattern(withdrawalEntrypoint, /WITHDRAWAL_CANDIDATE_READ_ONLY/, 'withdrawal mutation lock is missing', failures)
requirePattern(withdrawalEntrypoint, /withdrawalsReady:\s*false/, 'withdrawal readiness must remain false', failures)
requirePattern(withdrawalEntrypoint, /candidate_build_cannot_submit_transfers/, 'transfer submission lock reason is missing', failures)
requirePattern(withdrawalEntrypoint, /provider_not_configured/, 'provider-disconnected readiness check is missing', failures)
requirePattern(withdrawalEntrypoint, /if \(!SAFE_METHODS\.has\(method\)\)/, 'general transfer mutations are not blocked', failures)

requirePattern(transferState, /PENDING_APPROVAL/, 'withdrawal approval state is missing', failures)
requirePattern(transferState, /TIME_LOCKED/, 'withdrawal time-lock state is missing', failures)
requirePattern(transferState, /RECOVERY_REQUIRED/, 'transfer recovery state is missing', failures)
requirePattern(withdrawalPolicy, /requiredApprovalCount/, 'distinct approval-count policy is missing', failures)
requirePattern(withdrawalPolicy, /requiredApprovalRoles/, 'approval role separation is missing', failures)
requirePattern(withdrawalPolicy, /requester_did_not_self_approve/, 'requester self-approval prevention is missing', failures)
requirePattern(withdrawalPolicy, /destination_active_and_screened/, 'destination screening policy is missing', failures)
requirePattern(withdrawalPolicy, /time_lock_satisfied/, 'withdrawal time-lock policy is missing', failures)
requirePattern(withdrawalPolicy, /candidate_build_unlocked/, 'candidate withdrawal lock policy is missing', failures)

requirePattern(authorization, /separation_of_duties_violation/, 'authorization separation of duties is missing', failures)
requirePattern(authorization, /valid_step_up_session_missing/, 'step-up authentication policy is missing', failures)
requirePattern(guardian, /requester cannot self-approve|cannot self-approve/, 'Guardian reset self-approval prevention is missing', failures)
requirePattern(guardian, /both risk and release approval roles/, 'Guardian dual-role reset approval is missing', failures)
requirePattern(userStream, /sequence_gap_detected/, 'user-stream sequence-gap recovery is missing', failures)
requirePattern(userStream, /REST_SNAPSHOT_REQUIRED/, 'REST snapshot recovery decision is missing', failures)
requirePattern(queueContracts, /INSERT OR IGNORE INTO live_queue_messages/, 'queue delivery deduplication is missing', failures)
requirePattern(queueContracts, /DEAD_LETTER/, 'queue dead-letter handling is missing', failures)

requirePattern(transferMigration, /destination_ref_hash/, 'destination references must be hashed', failures)
requirePattern(transferMigration, /live_withdrawal_approvals/, 'withdrawal approval table is missing', failures)
requirePattern(transferMigration, /step_up_session_id/, 'withdrawal step-up evidence is missing', failures)
requirePattern(transferMigration, /live_transfer_events_no_update/, 'immutable transfer event guard is missing', failures)
requirePattern(authorizationMigration, /live_step_up_sessions/, 'step-up session table is missing', failures)
requirePattern(authorizationMigration, /live_authorization_events_no_update/, 'immutable authorization events are missing', failures)
requirePattern(queueMigration, /live_dead_letter_records_no_update/, 'immutable dead-letter records are missing', failures)

const forbiddenSecretAssignments = /(API_KEY|API_SECRET|PRIVATE_KEY|PASSPHRASE|SEED_PHRASE)\s*=\s*"[^"\s]+"/i
if (forbiddenSecretAssignments.test(withdrawalConfig)) {
  failures.push('plaintext secret-like value found in withdrawal candidate config')
}
if (/\[triggers\]/.test(withdrawalConfig) || /crons\s*=/.test(withdrawalConfig)) {
  failures.push('withdrawal candidate must not have scheduled triggers')
}
if (/routes\s*=|route\s*=/.test(withdrawalConfig)) {
  failures.push('withdrawal candidate must not have a public route')
}

const productionIdentifiers = [
  'd647c639-845a-414e-9bb4-513e42ef4451',
  'crypto-signal-bot-storage',
  '8f0321c43b844ec08c514f1d04839a3c',
]
for (const identifier of productionIdentifiers) {
  if (withdrawalConfig.includes(identifier)) {
    failures.push(`production resource identifier leaked into withdrawal config: ${identifier}`)
  }
}

if (failures.length > 0) {
  console.error('Regulated foundation safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Regulated foundation safety verification passed.')
