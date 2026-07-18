import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src/live/bitget-attested-recovery-ingestion.ts')
const migrationPath = path.join(root, 'migrations/023_live_bitget_attested_recovery_ingestion.sql')
const source = fs.readFileSync(sourcePath, 'utf8')
const migration = fs.readFileSync(migrationPath, 'utf8')

const requiredSourceTokens = [
  'persistAttestedBitgetRecoveryIngestion',
  'loadAttestationPackage',
  'loadCertificationChecks',
  'persistBitgetRecoveryIngestion',
  'all eight read-only certification checks to pass',
  'recovery ingestion plan hash is invalid',
  'automaticAccountingDispatchAllowed: false',
  'reservationSettlementAllowed: false',
  'certificationCheckProjectionAllowed: false',
  'certifiedForLive: false',
  'providerMutationAllowed: false',
  'automaticRetryAllowed: false',
  'transferAllowed: false',
  'withdrawalAllowed: false',
  'executionAllowed: false',
  'credentialsPersisted: false',
  'reconciliationRequired: true',
  'incidentEvidenceRequired: true',
  "'ATTESTED_RECOVERY_BOUND'",
]

for (const token of requiredSourceTokens) {
  if (!source.includes(token)) throw new Error(`attested recovery ingestion missing required token: ${token}`)
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
  /dispatchApproved/i,
  /persistVerifiedFillAccounting/i,
  /settleReservation/i,
  /certificationCheckProjectionAllowed:\s*true/,
  /certifiedForLive:\s*true/,
  /providerMutationAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /app\.(?:post|put|patch|delete)\s*\(/,
]

for (const pattern of forbiddenSourcePatterns) {
  if (pattern.test(source)) throw new Error(`attested recovery ingestion contains forbidden pattern: ${pattern}`)
}

const requiredMigrationTokens = [
  'CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_ingestions',
  'CREATE TABLE IF NOT EXISTS live_bitget_attested_recovery_ingestion_events',
  "source_mode IN ('INJECTED_FIXTURES', 'ISOLATED_READ_ONLY_CLIENT')",
  "certification_environment = 'LOCAL_TEST'",
  "certification_environment IN ('SHADOW', 'TESTNET', 'LIVE_CANDIDATE')",
  'automatic_accounting_dispatch_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_accounting_dispatch_allowed = 0)',
  'reservation_settlement_allowed INTEGER NOT NULL DEFAULT 0 CHECK (reservation_settlement_allowed = 0)',
  'certification_check_projection_allowed INTEGER NOT NULL DEFAULT 0 CHECK (certification_check_projection_allowed = 0)',
  'certified_for_live INTEGER NOT NULL DEFAULT 0 CHECK (certified_for_live = 0)',
  'provider_mutation_allowed INTEGER NOT NULL DEFAULT 0 CHECK (provider_mutation_allowed = 0)',
  'automatic_retry_allowed INTEGER NOT NULL DEFAULT 0 CHECK (automatic_retry_allowed = 0)',
  'execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0)',
  'credentials_persisted INTEGER NOT NULL DEFAULT 0 CHECK (credentials_persisted = 0)',
  'reconciliation_required INTEGER NOT NULL DEFAULT 1 CHECK (reconciliation_required = 1)',
  'incident_evidence_required INTEGER NOT NULL DEFAULT 1 CHECK (incident_evidence_required = 1)',
  "event_type TEXT NOT NULL CHECK (event_type = 'ATTESTED_RECOVERY_BOUND')",
  'live_bitget_attested_recovery_ingestions_no_update',
  'live_bitget_attested_recovery_ingestions_no_delete',
  'live_bitget_attested_recovery_events_no_update',
  'live_bitget_attested_recovery_events_no_delete',
]

for (const token of requiredMigrationTokens) {
  if (!migration.includes(token)) throw new Error(`attested recovery migration missing required token: ${token}`)
}

const forbiddenMigrationPatterns = [
  /api[_-]?key/i,
  /secret[_-]?key/i,
  /passphrase/i,
  /raw[_-]?(?:balance|order|fill)/i,
  /certified_for_live[^\n]*DEFAULT\s+1/i,
  /provider_mutation_allowed[^\n]*DEFAULT\s+1/i,
  /execution_allowed[^\n]*DEFAULT\s+1/i,
]

for (const pattern of forbiddenMigrationPatterns) {
  if (pattern.test(migration)) throw new Error(`attested recovery migration contains forbidden pattern: ${pattern}`)
}

console.log('Bitget attested recovery ingestion safety verified.')
