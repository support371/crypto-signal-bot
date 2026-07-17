import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const failures = []
const plan = read('worker/src/live/bitget-recovery-accounting-plan.ts')
const integrity = read('worker/src/live/recovery-accounting-plan-integrity.ts')
const approval = read('worker/src/live/recovery-accounting-approval.ts')
const service = read('worker/src/live/recovery-accounting-approval-service.ts')
const store = read('worker/src/live/recovery-accounting-approval-store.ts')
const migration = read('worker/migrations/018_live_recovery_accounting_approval.sql')
const packageJson = read('worker/package.json')
const entrypoint = read('worker/src/index_live_candidate.ts')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ['buildBitgetRecoveryAccountingPlan', 'recovery accounting plan builder is missing'],
  ['accountingEvidenceReady: true', 'accounting evidence readiness marker is missing'],
  ['automaticallyDispatched: false', 'recovery accounting plan must not auto-dispatch'],
  ['providerMutationAllowed: false', 'plan provider mutation lock is missing'],
  ['reservationApplied: false', 'plan reservation lock is missing'],
  ['executionAllowed: false', 'plan execution lock is missing'],
]) requireToken(plan, token, message)

for (const [token, message] of [
  ['calculateBitgetRecoveryAccountingPlanHash', 'plan hash recomputation is missing'],
  ['assertBitgetRecoveryAccountingPlanIntegrity', 'plan integrity verifier is missing'],
  ['recovery accounting plan hash does not match its commands', 'tampered-plan rejection is missing'],
]) requireToken(integrity, token, message)

for (const [token, message] of [
  ["action: 'RUN_RECONCILIATION'", 'approval must use reconciliation authorization'],
  ["resourceType: 'RECOVERY_ACCOUNTING_PLAN'", 'approval resource binding is missing'],
  ["RISK_APPROVAL_ROLES = new Set(['RISK_OPERATOR', 'RISK_ADMIN'])", 'risk-role approval requirement is missing'],
  ['risk_approval_role_required', 'missing risk-role denial reason is absent'],
  ['plan_preparer_cannot_approve', 'plan preparer separation is missing'],
  ['automaticallyDispatched: false', 'approval must not dispatch accounting'],
  ['providerMutationAllowed: false', 'approval provider mutation lock is missing'],
  ['reservationApplied: false', 'approval reservation lock is missing'],
  ['executionAllowed: false', 'approval execution lock is missing'],
]) requireToken(approval, token, message)

for (const [token, message] of [
  ['assertBitgetRecoveryAccountingPlanIntegrity', 'verified approval must recompute plan integrity'],
  ['planIntegrityVerified: true', 'verified integrity evidence is missing'],
  ['automaticallyDispatched: false', 'verified approval must remain non-dispatching'],
  ['providerMutationAllowed: false', 'verified provider mutation lock is missing'],
  ['reservationApplied: false', 'verified reservation lock is missing'],
  ['executionAllowed: false', 'verified execution lock is missing'],
]) requireToken(service, token, message)

for (const [token, message] of [
  ['persistRecoveryAccountingApproval', 'approval persistence store is missing'],
  ['INSERT INTO live_authorization_events', 'atomic authorization insert is missing'],
  ['INSERT INTO live_recovery_accounting_plans', 'immutable plan insert is missing'],
  ['INSERT INTO live_recovery_accounting_approval_events', 'immutable approval insert is missing'],
  ['await env.DB.batch(statements)', 'plan, authorization, and approval must use one D1 batch'],
  ['assertAuthorizationCompatible', 'authorization replay verification is missing'],
  ['assertPlanCompatible', 'plan replay verification is missing'],
  ['assertApprovalCompatible', 'approval replay verification is missing'],
  ['approval event exists without its immutable plan and authorization evidence', 'orphan approval quarantine is missing'],
  ['automaticallyDispatched: false', 'store dispatch lock is missing'],
  ['providerMutationAllowed: false', 'store provider mutation lock is missing'],
  ['reservationApplied: false', 'store reservation lock is missing'],
  ['executionAllowed: false', 'store execution lock is missing'],
]) requireToken(store, token, message)

for (const [token, message] of [
  ['-- Migration 018:', 'approval migration must be sequence 018'],
  ['live_recovery_accounting_plans', 'recovery accounting plan table is missing'],
  ['live_recovery_accounting_approval_events', 'recovery approval event table is missing'],
  ['FOREIGN KEY (authorization_event_id) REFERENCES live_authorization_events', 'authorization evidence foreign key is missing'],
  ['CHECK (automatically_dispatched = 0)', 'migration dispatch lock is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'migration provider mutation lock is missing'],
  ['CHECK (reservation_applied = 0)', 'migration reservation lock is missing'],
  ['CHECK (execution_allowed = 0)', 'migration execution lock is missing'],
  ['live_recovery_accounting_plans_no_update', 'plan immutability trigger is missing'],
  ['live_recovery_accounting_approval_events_no_update', 'approval immutability trigger is missing'],
]) requireToken(migration, token, message)

requireToken(
  packageJson,
  '018_live_recovery_accounting_approval.sql',
  'migration 018 command is missing from worker package scripts',
)

for (const forbidden of [
  'accountSpotFillFifo(',
  'persistSpotFillAccounting',
  'persistReservationSettlement',
  'createOrder',
  'cancelOrder',
  'replaceOrder',
  'requestWithdrawal',
  'automaticallyDispatched: true',
  'providerMutationAllowed: true',
  'reservationApplied: true',
  'executionAllowed: true',
]) {
  if (
    approval.includes(forbidden)
    || service.includes(forbidden)
    || store.includes(forbidden)
  ) {
    failures.push(`forbidden recovery approval capability detected: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/recovery/accounting/approve')
  || entrypoint.includes('/recovery/accounting/dispatch')
  || entrypoint.includes('/recovery-accounting-approval')
) {
  failures.push('recovery accounting approval must not be publicly exposed')
}

if (fs.existsSync(path.join(repoRoot, 'worker/migrations/017_live_recovery_accounting_approval.sql'))) {
  failures.push('obsolete duplicate migration 017 recovery approval file still exists')
}

if (failures.length > 0) {
  console.error('Recovery accounting approval safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Recovery accounting approval safety verification passed.')
