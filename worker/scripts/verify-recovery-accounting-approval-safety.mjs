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
const dispatchService = read('worker/src/live/recovery-accounting-dispatch-service.ts')
const freshness = read('worker/src/live/recovery-accounting-dispatch-freshness.ts')
const migration = read('worker/migrations/018_live_recovery_accounting_approval.sql')
const validityMigration = read('worker/migrations/019_live_recovery_accounting_approval_validity.sql')
const attemptMigration = read('worker/migrations/020_live_recovery_accounting_dispatch_attempts.sql')
const orchestrator = read('worker/src/live/recovery-accounting-fresh-dispatch-orchestrator.ts')
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
  ['Object.defineProperty(approvedPackage, VERIFIED_APPROVAL_PACKAGE', 'verified approval brand must use defineProperty'],
  ['enumerable: false', 'verified approval brand must be non-enumerable'],
  ['configurable: false', 'verified approval brand must be non-configurable'],
  ['writable: false', 'verified approval brand must be non-writable'],
  ['sealDerivedVerifiedApprovedRecoveryAccountingPackage', 'verified derived-package sealing is missing'],
  ['assertVerifiedApprovalBrand(source)', 'derived package must verify its branded source at runtime'],
]) requireToken(dispatchService, token, message)

for (const [token, message] of [
  ['Object.defineProperty(approvedPackage, FRESH_APPROVAL_PACKAGE', 'fresh approval brand must use defineProperty'],
  ['enumerable: false', 'fresh approval brand must be non-enumerable'],
  ['configurable: false', 'fresh approval brand must be non-configurable'],
  ['writable: false', 'fresh approval brand must be non-writable'],
  ['sealDerivedVerifiedApprovedRecoveryAccountingPackage', 'fresh package must preserve verified approval through runtime sealing'],
  ['row.validity_seconds > 900', 'approval validity must remain capped at fifteen minutes'],
  ['nowMs >= expiresAtMs', 'approval expiry enforcement is missing'],
  ['automaticallyDispatched: false', 'fresh approval must not auto-dispatch'],
  ['providerMutationAllowed: false', 'fresh approval provider mutation lock is missing'],
  ['reservationApplied: false', 'fresh approval reservation lock is missing'],
  ['executionAllowed: false', 'fresh approval execution lock is missing'],
]) requireToken(freshness, token, message)

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

for (const [token, message] of [
  ['-- Migration 019:', 'approval validity migration must be sequence 019'],
  ['validity_seconds >= 1 AND validity_seconds <= 900', 'approval validity database cap is missing'],
  ['automatically_retried = 0', 'approval validity automatic-retry lock is missing'],
  ['idx_live_recovery_one_completed_dispatch_per_plan', 'one-completed-dispatch constraint is missing'],
  ['live_recovery_accounting_approval_validity_no_update', 'approval validity update protection is missing'],
  ['live_recovery_accounting_approval_validity_no_delete', 'approval validity delete protection is missing'],
]) requireToken(validityMigration, token, message)

for (const [token, message] of [
  ['claimFreshRecoveryAccountingDispatchAttempt', 'immutable dispatch attempt claim is missing'],
  ["previous?.status === 'COMPLETED'", 'completed-plan replay rejection is missing'],
  ['new independently reviewed approval', 'partial resume must require new reviewed approval'],
  ['return executor.serializer.run', 'orchestration must remain inside the per-account serializer'],
  ['clock.now()', 'approval freshness must use the trusted orchestration clock'],
  ['persistRecoveryAccountingDispatchResult', 'dispatch summary persistence is missing'],
  ['providerMutationAllowed: false', 'orchestration provider mutation lock is missing'],
  ['reservationApplied: false', 'orchestration reservation lock is missing'],
  ['executionAllowed: false', 'orchestration execution lock is missing'],
]) requireToken(orchestrator, token, message)

for (const [token, message] of [
  ['live_recovery_accounting_dispatch_attempts', 'dispatch attempt table is missing'],
  ['UNIQUE (plan_id, predecessor_attempt_id)', 'dispatch predecessor uniqueness is missing'],
  ['approval_event_id TEXT NOT NULL UNIQUE', 'one-attempt-per-approval constraint is missing'],
  ['completed recovery accounting plan cannot be dispatched again', 'completed-plan database guard is missing'],
  ['new approval', 'partial-resume database approval guard is missing'],
  ['CHECK (automatically_retried = 0)', 'dispatch attempt automatic retry lock is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'dispatch attempt provider mutation lock is missing'],
  ['CHECK (reservation_applied = 0)', 'dispatch attempt reservation lock is missing'],
  ['CHECK (execution_allowed = 0)', 'dispatch attempt execution lock is missing'],
  ['live_recovery_accounting_dispatch_attempts_no_update', 'dispatch attempt immutability trigger is missing'],
]) requireToken(attemptMigration, token, message)

for (const [token, message] of [
  ['018_live_recovery_accounting_approval.sql', 'migration 018 approval command is missing'],
  ['018_live_recovery_accounting_dispatch.sql', 'migration 018 dispatch command is missing'],
  ['019_live_recovery_accounting_approval_validity.sql', 'migration 019 validity command is missing'],
  ['020_live_recovery_accounting_dispatch_attempts.sql', 'migration 020 dispatch-attempt command is missing'],
  ['verify:migrations', 'live migration replay verifier is missing'],
]) requireToken(packageJson, token, message)

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
    || dispatchService.includes(forbidden)
    || freshness.includes(forbidden)
    || orchestrator.includes(forbidden)
  ) {
    failures.push(`forbidden recovery approval capability detected: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/recovery/accounting/approve')
  || entrypoint.includes('/recovery/accounting/dispatch')
  || entrypoint.includes('/recovery-accounting-approval')
  || entrypoint.includes('/recovery-accounting-validity')
  || entrypoint.includes('/recovery-accounting-attempt')
  || entrypoint.includes('/recovery-accounting-fresh-dispatch')
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
