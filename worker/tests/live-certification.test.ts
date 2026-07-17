import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateCertification,
  REQUIRED_CERTIFICATION_CHECKS,
  type CertificationRunEvidence,
} from '../src/live/certification.ts'

function passedRun(): CertificationRunEvidence {
  return {
    certificationId: 'certification-1',
    releaseId: 'release-1',
    gitSha: 'a'.repeat(40),
    workerDeploymentId: 'worker-deployment-1',
    frontendDeploymentId: 'frontend-deployment-1',
    schemaVersion: '013',
    exchangeName: 'coinbase',
    exchangeAccountId: 'account-ref-hash',
    environment: 'LIVE_CANDIDATE',
    status: 'PASSED',
    startedAt: '2026-07-17T09:00:00.000Z',
    completedAt: '2026-07-17T09:30:00.000Z',
    expiresAt: '2026-07-18T09:30:00.000Z',
    securityReviewRef: 'security-review-1',
    complianceReviewRef: 'compliance-review-1',
    rollbackEvidenceRef: 'rollback-evidence-1',
    disasterRecoveryEvidenceRef: 'dr-evidence-1',
    checks: REQUIRED_CERTIFICATION_CHECKS.map(([checkName, category], index) => ({
      checkName,
      category,
      mandatory: true,
      status: 'PASS' as const,
      evidenceRef: `evidence-${index + 1}`,
      evidenceHash: index.toString(16).padStart(64, '0'),
      evaluatedAt: '2026-07-17T09:20:00.000Z',
      evaluatorId: 'certification-agent-1',
    })),
  }
}

test('complete current evidence passes certification but never activates candidate', () => {
  const decision = evaluateCertification(
    passedRun(),
    new Date('2026-07-17T10:00:00.000Z'),
  )

  assert.equal(decision.evidenceComplete, true)
  assert.equal(decision.certificationCurrent, true)
  assert.equal(decision.certificationPassed, true)
  assert.equal(decision.certifiedForLive, false)
  assert.deepEqual(decision.reasons, [])
})

test('missing mandatory check blocks certification', () => {
  const run = passedRun()
  const removed = run.checks[0].checkName
  const decision = evaluateCertification({
    ...run,
    checks: run.checks.slice(1),
  }, new Date('2026-07-17T10:00:00.000Z'))

  assert.equal(decision.certificationPassed, false)
  assert.ok(decision.missingMandatoryChecks.includes(removed))
  assert.ok(decision.reasons.includes('mandatory_evidence_missing'))
})

test('failed, blocked, and pending checks are reported separately', () => {
  const run = passedRun()
  const checks = run.checks.map((check, index) => ({
    ...check,
    status: index === 0
      ? 'FAIL' as const
      : index === 1
        ? 'BLOCKED' as const
        : index === 2
          ? 'PENDING' as const
          : check.status,
  }))
  const decision = evaluateCertification(
    { ...run, checks },
    new Date('2026-07-17T10:00:00.000Z'),
  )

  assert.equal(decision.certificationPassed, false)
  assert.equal(decision.failedMandatoryChecks.length, 1)
  assert.equal(decision.blockedMandatoryChecks.length, 1)
  assert.equal(decision.pendingMandatoryChecks.length, 1)
})

test('expired certification evidence is not current', () => {
  const decision = evaluateCertification({
    ...passedRun(),
    expiresAt: '2026-07-17T09:59:59.000Z',
  }, new Date('2026-07-17T10:00:00.000Z'))

  assert.equal(decision.certificationCurrent, false)
  assert.equal(decision.certificationPassed, false)
  assert.ok(decision.reasons.includes('certification_expired_or_revoked'))
})

test('passing check without full evidence is treated as missing', () => {
  const run = passedRun()
  const first = run.checks[0]
  const decision = evaluateCertification({
    ...run,
    checks: [
      { ...first, evidenceHash: null },
      ...run.checks.slice(1),
    ],
  }, new Date('2026-07-17T10:00:00.000Z'))

  assert.equal(decision.certificationPassed, false)
  assert.ok(decision.missingMandatoryChecks.includes(first.checkName))
})
