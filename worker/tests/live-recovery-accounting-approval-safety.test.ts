import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

test('recovery accounting approval remains integrity-verified, time-bound, and non-dispatching', () => {
  const integrity = read('worker/src/live/recovery-accounting-plan-integrity.ts')
  const approval = read('worker/src/live/recovery-accounting-approval.ts')
  const service = read('worker/src/live/recovery-accounting-approval-service.ts')
  const store = read('worker/src/live/recovery-accounting-approval-store.ts')
  const dispatchService = read('worker/src/live/recovery-accounting-dispatch-service.ts')
  const freshness = read('worker/src/live/recovery-accounting-dispatch-freshness.ts')
  const approvalMigration = read('worker/migrations/018_live_recovery_accounting_approval.sql')
  const validityMigration = read('worker/migrations/019_live_recovery_accounting_approval_validity.sql')
  const entrypoint = read('worker/src/index_live_candidate.ts')

  for (const [content, token] of [
    [integrity, 'calculateBitgetRecoveryAccountingPlanHash'],
    [integrity, 'plan hash does not match its commands'],
    [integrity, 'automaticallyDispatched !== false'],
    [approval, "action: 'RUN_RECONCILIATION'"],
    [approval, 'risk_approval_role_required'],
    [approval, 'plan_preparer_cannot_approve'],
    [approval, 'automaticallyDispatched: false'],
    [service, 'assertBitgetRecoveryAccountingPlanIntegrity'],
    [service, 'planIntegrityVerified: true'],
    [store, 'evaluateVerifiedRecoveryAccountingApproval'],
    [store, 'INSERT INTO live_authorization_events'],
    [store, 'INSERT INTO live_recovery_accounting_plans'],
    [store, 'INSERT INTO live_recovery_accounting_approval_events'],
    [store, 'await env.DB.batch(statements)'],
    [store, 'assertAuthorizationCompatible'],
    [store, 'assertPlanCompatible'],
    [store, 'assertApprovalCompatible'],
    [store, 'automaticallyDispatched: false'],
    [dispatchService, 'Object.defineProperty(approvedPackage, VERIFIED_APPROVAL_PACKAGE'],
    [dispatchService, 'enumerable: false'],
    [dispatchService, 'configurable: false'],
    [dispatchService, 'writable: false'],
    [dispatchService, 'sealDerivedVerifiedApprovedRecoveryAccountingPackage'],
    [freshness, 'Object.defineProperty(approvedPackage, FRESH_APPROVAL_PACKAGE'],
    [freshness, 'row.validity_seconds > 900'],
    [freshness, 'nowMs >= expiresAtMs'],
    [freshness, 'automaticallyDispatched: false'],
    [approvalMigration, 'live_recovery_accounting_plans_no_update'],
    [approvalMigration, 'live_recovery_accounting_approval_events_no_update'],
    [approvalMigration, 'CHECK (automatically_dispatched = 0)'],
    [approvalMigration, 'CHECK (provider_mutation_allowed = 0)'],
    [approvalMigration, 'CHECK (reservation_applied = 0)'],
    [approvalMigration, 'CHECK (execution_allowed = 0)'],
    [validityMigration, 'validity_seconds >= 1 AND validity_seconds <= 900'],
    [validityMigration, 'CHECK (automatically_retried = 0)'],
    [validityMigration, 'idx_live_recovery_one_completed_dispatch_per_plan'],
    [validityMigration, 'live_recovery_accounting_approval_validity_no_update'],
    [validityMigration, 'live_recovery_accounting_approval_validity_no_delete'],
  ] as const) {
    assert.ok(content.includes(token), `missing recovery approval safety token: ${token}`)
  }

  for (const forbidden of [
    'persistSpotFillAccountingVerified(',
    'persistFillAccountingReconciliation(',
    '/candidate/fills/account',
    '/candidate/fills/reconcile',
    'createOrder',
    'cancelOrder',
    'replaceOrder',
    'requestWithdrawal',
    'automaticallyDispatched: true',
    'providerMutationAllowed: true',
    'reservationApplied: true',
    'executionAllowed: true',
  ]) {
    assert.equal(
      approval.includes(forbidden)
        || service.includes(forbidden)
        || store.includes(forbidden)
        || dispatchService.includes(forbidden)
        || freshness.includes(forbidden),
      false,
      `forbidden recovery approval capability: ${forbidden}`,
    )
  }

  assert.equal(entrypoint.includes('/recovery-accounting/approve'), false)
  assert.equal(entrypoint.includes('/candidate/recovery-accounting'), false)
  assert.equal(entrypoint.includes('/recovery-accounting-validity'), false)
})
