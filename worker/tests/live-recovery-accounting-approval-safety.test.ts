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

test('recovery accounting approval remains integrity-verified and non-dispatching', () => {
  const integrity = read('worker/src/live/recovery-accounting-plan-integrity.ts')
  const approval = read('worker/src/live/recovery-accounting-approval.ts')
  const service = read('worker/src/live/recovery-accounting-approval-service.ts')
  const store = read('worker/src/live/recovery-accounting-approval-store.ts')
  const migration = read('worker/migrations/017_live_recovery_accounting_approval.sql')
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
    [store, 'recordAuthorizationDecision'],
    [store, 'INSERT OR IGNORE INTO live_recovery_accounting_plans'],
    [store, 'INSERT INTO live_recovery_accounting_approval_events'],
    [store, 'automaticallyDispatched: false'],
    [migration, 'live_recovery_accounting_plans_no_update'],
    [migration, 'live_recovery_accounting_approval_events_no_update'],
    [migration, 'CHECK (automatically_dispatched = 0)'],
    [migration, 'CHECK (provider_mutation_allowed = 0)'],
    [migration, 'CHECK (reservation_applied = 0)'],
    [migration, 'CHECK (execution_allowed = 0)'],
  ] as const) {
    assert.ok(content.includes(token), `missing recovery approval safety token: ${token}`)
  }

  for (const forbidden of [
    'persistSpotFillAccountingVerified(',
    'persistFillAccountingReconciliation(',
    '/candidate/fills/account',
    '/candidate/fills/reconcile',
    'automaticallyDispatched: true',
    'providerMutationAllowed: true',
    'reservationApplied: true',
    'executionAllowed: true',
  ]) {
    assert.equal(
      approval.includes(forbidden)
        || service.includes(forbidden)
        || store.includes(forbidden),
      false,
      `forbidden recovery approval capability: ${forbidden}`,
    )
  }

  assert.equal(entrypoint.includes('/recovery-accounting/approve'), false)
  assert.equal(entrypoint.includes('/candidate/recovery-accounting'), false)
})
