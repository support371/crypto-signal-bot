import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src/live/bitget-attested-recovery-readiness.ts')
const migrationPath = path.join(root, 'migrations/024_live_bitget_attested_recovery_readiness.sql')
const source = fs.readFileSync(sourcePath, 'utf8')
const migration = fs.readFileSync(migrationPath, 'utf8')

const requiredSourceTokens = [
  'evaluateAndPersistBitgetAttestedRecoveryReadiness',
  "'PENDING_ACCOUNTING_REVIEW'",
  "'PENDING_SETTLEMENT'",
  "'PENDING_RECONCILIATION'",
  "'CLEAR'",
  "'HALT_FOR_REVIEW'",
  'const STALE_AFTER_MS = 15 * 60 * 1000',
  'live_bitget_attested_recovery_ingestions',
  'live_recovery_accounting_task_intents',
  'live_fill_accounting_receipts',
  'live_reservation_settlement_receipts',
  'live_recovery_accounting_dispatches',
  'live_fill_accounting_reconciliations',
  'accounting_review_required',
  'reservation_settlement_evidence_missing',
  'reconciliation_evidence_missing_or_stale',
  'attested_recovery_backlog_stale',
  'automaticAccountingDispatchAllowed: false',
  'automaticReservationSettlementAllowed: false',
  'automaticReconciliationAllowed: false',
  'certificationCheckProjectionAllowed: false',
  'certifiedForLive: false',
  'providerMutationAllowed: false',
  'automaticRetryAllowed: false',
  'transferAllowed: false',
  'withdrawalAllowed: false',
  'executionAllowed: false',
  'credentialsPersisted: false',
  "'ATTESTED_RECOVERY_READINESS_EVALUATED'",
]

for (const token of requiredSourceTokens) {
  if (!source.includes(token)) throw new Error(`attested recovery readiness missing required token: ${token}`)
}

const forbiddenSourcePatterns = [
  /\bfetch\s*\(/,
  /ACCESS-KEY/i,
  /secretKey/i,
  /passphrase/i,
  /signBitget/i,
  /submit(?:Order|Candidate)/i,
  /createOrder\s*\(/,
  /cancelOrder\s*\(/,
  /replaceOrder\s*\(/,
  /dispatchApprovedRecoveryAccounting/i,
  /persistVerifiedFillAccounting\s*\(/,
  /persistReservationSettlement\s*\(/,
  /reconcileAndPersist/i,
  /automaticAccountingDispatchAllowed:\s*true/,
  /automaticReservationSettlementAllowed:\s*true/,
  /automaticReconciliationAllowed:\s*true/,
  /certificationCheckProjectionAllowed:\s*true/,
  /certifiedForLive:\s*true/,
  /providerMutationAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /app\.(?:post|put|patch|delete)\s*\(/,
]

for (const pattern of forbiddenSourcePatterns) {
  if (pattern.test(source)) throw new Error(`attested recovery readiness contains forbidden pattern: ${pattern}`)
}

const requiredMigrationTokens = [
  'CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_readiness',
  'CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_readiness_events',
  "'PENDING_ACCOUNTING_REVIEW'",
  "'PENDING_SETTLEMENT'",
  "'PENDING_RECONCILIATION'",
  "'CLEAR'",
  "'HALT_FOR_REVIEW'",
  'automatic_accounting_dispatch_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_accounting_dispatch_allowed = 0)',
  'automatic_reservation_settlement_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_reservation_settlement_allowed = 0)',
  'automatic_reconciliation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_reconciliation_allowed = 0)',
  'certification_check_projection_allowed INTEGER NOT NULL DEFAULT 0 CHECK (certification_check_projection_allowed = 0)',
  'certified_for_live INTEGER NOT NULL DEFAULT 0 CHECK (certified_for_live = 0)',
  'provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0)',
  'automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0)',
  'execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0)',
  'credentials_persisted INTEGER NOT NULL DEFAULT 0 CHECK (credentials_persisted = 0)',
  "event_type TEXT NOT NULL CHECK (event_type = 'ATTESTED_RECOVERY_READINESS_EVALUATED')",
  'live_bitget_attested_recovery_readiness_no_update',
  'live_bitget_attested_recovery_readiness_no_delete',
  'live_bitget_attested_recovery_readiness_events_no_update',
  'live_bitget_attested_recovery_readiness_events_no_delete',
]

for (const token of requiredMigrationTokens) {
  if (!migration.includes(token)) throw new Error(`attested recovery readiness migration missing required token: ${token}`)
}

const forbiddenMigrationPatterns = [
  /api[_-]?key/i,
  /secret[_-]?key/i,
  /passphrase/i,
  /automatic_accounting_dispatch_allowed[^\n]*DEFAULT\s+1/i,
  /automatic_reservation_settlement_allowed[^\n]*DEFAULT\s+1/i,
  /automatic_reconciliation_allowed[^\n]*DEFAULT\s+1/i,
  /certified_for_live[^\n]*DEFAULT\s+1/i,
  /provider_mutation_allowed[^\n]*DEFAULT\s+1/i,
  /execution_allowed[^\n]*DEFAULT\s+1/i,
]

for (const pattern of forbiddenMigrationPatterns) {
  if (pattern.test(migration)) throw new Error(`attested recovery readiness migration contains forbidden pattern: ${pattern}`)
}

console.log('Bitget attested recovery readiness safety verified.')
