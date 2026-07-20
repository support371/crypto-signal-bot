import { normalizeExecutionExchange } from './exchange-registry.ts'

export type CertificationEnvironment = 'SHADOW' | 'SANDBOX' | 'TESTNET' | 'LIVE_CANDIDATE'
export type CertificationRunStatus = 'RUNNING' | 'PASSED' | 'FAILED' | 'EXPIRED' | 'REVOKED'
export type CertificationCheckStatus = 'PENDING' | 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_APPLICABLE'
export type CertificationCategory =
  | 'BUILD'
  | 'SECURITY'
  | 'AUTHORIZATION'
  | 'EXCHANGE'
  | 'MARKET_DATA'
  | 'ORDER_LIFECYCLE'
  | 'LEDGER'
  | 'RECONCILIATION'
  | 'GUARDIAN'
  | 'QUEUES'
  | 'TRANSFERS'
  | 'OBSERVABILITY'
  | 'ROLLBACK'
  | 'DISASTER_RECOVERY'

export const REQUIRED_CERTIFICATION_CHECKS = Object.freeze([
  ['locked_build_typecheck_passed', 'BUILD'],
  ['locked_foundation_tests_passed', 'BUILD'],
  ['candidate_bundle_passed', 'BUILD'],
  ['secret_scan_passed', 'SECURITY'],
  ['threat_model_review_passed', 'SECURITY'],
  ['role_separation_passed', 'AUTHORIZATION'],
  ['step_up_authentication_passed', 'AUTHORIZATION'],
  ['provider_read_only_permissions_passed', 'EXCHANGE'],
  ['provider_contract_tests_passed', 'EXCHANGE'],
  ['market_data_freshness_passed', 'MARKET_DATA'],
  ['product_rules_validation_passed', 'MARKET_DATA'],
  ['order_state_machine_passed', 'ORDER_LIFECYCLE'],
  ['idempotency_replay_passed', 'ORDER_LIFECYCLE'],
  ['ambiguous_submission_recovery_passed', 'ORDER_LIFECYCLE'],
  ['double_entry_balance_passed', 'LEDGER'],
  ['reservation_release_passed', 'LEDGER'],
  ['rest_reconciliation_passed', 'RECONCILIATION'],
  ['user_stream_gap_recovery_passed', 'RECONCILIATION'],
  ['guardian_hierarchy_passed', 'GUARDIAN'],
  ['guardian_dual_approval_reset_passed', 'GUARDIAN'],
  ['queue_redelivery_deduplication_passed', 'QUEUES'],
  ['dead_letter_recovery_passed', 'QUEUES'],
  ['withdrawal_candidate_lock_passed', 'TRANSFERS'],
  ['withdrawal_dual_approval_passed', 'TRANSFERS'],
  ['alert_deduplication_passed', 'OBSERVABILITY'],
  ['audit_chain_integrity_passed', 'OBSERVABILITY'],
  ['rollback_rehearsal_passed', 'ROLLBACK'],
  ['disaster_recovery_rehearsal_passed', 'DISASTER_RECOVERY'],
] as const satisfies readonly (readonly [string, CertificationCategory])[])

export interface CertificationCheckEvidence {
  checkName: string
  category: CertificationCategory
  mandatory: boolean
  status: CertificationCheckStatus
  evidenceRef: string | null
  evidenceHash: string | null
  evaluatedAt: string | null
  evaluatorId: string | null
}

export interface CertificationRunEvidence {
  certificationId: string
  releaseId: string
  gitSha: string
  workerDeploymentId: string
  frontendDeploymentId: string
  schemaVersion: string
  exchangeName: string
  exchangeAccountId: string
  environment: CertificationEnvironment
  status: CertificationRunStatus
  startedAt: string
  completedAt: string | null
  expiresAt: string
  securityReviewRef: string
  complianceReviewRef: string
  rollbackEvidenceRef: string
  disasterRecoveryEvidenceRef: string
  checks: readonly CertificationCheckEvidence[]
}

export interface CertificationDecision {
  evidenceComplete: boolean
  certificationCurrent: boolean
  certificationPassed: boolean
  certifiedForLive: false
  reasons: readonly string[]
  missingMandatoryChecks: readonly string[]
  failedMandatoryChecks: readonly string[]
  blockedMandatoryChecks: readonly string[]
  pendingMandatoryChecks: readonly string[]
  duplicateChecks: readonly string[]
  evaluatedAt: string
}

const SHA1_PATTERN = /^[a-f0-9]{40}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function requiredText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function timestamp(value: unknown): number | null {
  if (!requiredText(value)) return null
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : null
}

function hasCompleteEvidence(check: CertificationCheckEvidence): boolean {
  return check.status === 'PASS'
    && requiredText(check.evidenceRef)
    && typeof check.evidenceHash === 'string'
    && SHA256_PATTERN.test(check.evidenceHash)
    && timestamp(check.evaluatedAt) !== null
    && requiredText(check.evaluatorId)
}

function uniqueSorted(values: Iterable<string>): readonly string[] {
  return Object.freeze(Array.from(new Set(values)).sort())
}

export function evaluateCertification(
  run: CertificationRunEvidence,
  now = new Date(),
): CertificationDecision {
  const reasons: string[] = []
  const missing = new Set<string>()
  const failed = new Set<string>()
  const blocked = new Set<string>()
  const pending = new Set<string>()
  const duplicates = new Set<string>()

  const nowMs = now.getTime()
  const startedAtMs = timestamp(run.startedAt)
  const completedAtMs = timestamp(run.completedAt)
  const expiresAtMs = timestamp(run.expiresAt)

  if (!Number.isFinite(nowMs)) reasons.push('evaluation_time_invalid')
  if (!requiredText(run.certificationId) || !requiredText(run.releaseId)) {
    reasons.push('certification_identity_missing')
  }
  if (!SHA1_PATTERN.test(run.gitSha)) reasons.push('git_sha_invalid')
  if (
    !requiredText(run.workerDeploymentId)
    || !requiredText(run.frontendDeploymentId)
    || !requiredText(run.schemaVersion)
    || !requiredText(run.exchangeAccountId)
  ) {
    reasons.push('deployment_identity_missing')
  }

  try {
    normalizeExecutionExchange(run.exchangeName)
  } catch {
    reasons.push('unsupported_certification_exchange')
  }

  if (run.environment !== 'LIVE_CANDIDATE') {
    reasons.push('certification_environment_not_live_candidate')
  }
  if (startedAtMs === null || expiresAtMs === null || expiresAtMs <= startedAtMs) {
    reasons.push('certification_time_window_invalid')
  }
  if (run.status === 'PASSED' && completedAtMs === null) {
    reasons.push('certification_completion_missing')
  }
  if (completedAtMs !== null && startedAtMs !== null && completedAtMs < startedAtMs) {
    reasons.push('certification_completion_before_start')
  }
  if (
    !requiredText(run.securityReviewRef)
    || !requiredText(run.complianceReviewRef)
    || !requiredText(run.rollbackEvidenceRef)
    || !requiredText(run.disasterRecoveryEvidenceRef)
  ) {
    reasons.push('required_review_evidence_missing')
  }

  const checksByName = new Map<string, CertificationCheckEvidence>()
  for (const check of run.checks) {
    const name = check.checkName.trim()
    if (!name) continue
    if (checksByName.has(name)) duplicates.add(name)
    else checksByName.set(name, check)
  }
  if (duplicates.size > 0) reasons.push('duplicate_certification_checks')

  for (const [checkName, expectedCategory] of REQUIRED_CERTIFICATION_CHECKS) {
    const check = checksByName.get(checkName)
    if (!check || !check.mandatory || check.category !== expectedCategory) {
      missing.add(checkName)
      continue
    }

    switch (check.status) {
      case 'PASS':
        if (!hasCompleteEvidence(check)) missing.add(checkName)
        break
      case 'FAIL':
        failed.add(checkName)
        break
      case 'BLOCKED':
        blocked.add(checkName)
        break
      case 'PENDING':
        pending.add(checkName)
        break
      case 'NOT_APPLICABLE':
        missing.add(checkName)
        break
    }
  }

  if (missing.size > 0) reasons.push('mandatory_evidence_missing')
  if (failed.size > 0) reasons.push('mandatory_checks_failed')
  if (blocked.size > 0) reasons.push('mandatory_checks_blocked')
  if (pending.size > 0) reasons.push('mandatory_checks_pending')

  const certificationCurrent = run.status === 'PASSED'
    && expiresAtMs !== null
    && Number.isFinite(nowMs)
    && nowMs < expiresAtMs

  if (!certificationCurrent) reasons.push('certification_expired_or_revoked')

  const evidenceComplete = missing.size === 0
    && failed.size === 0
    && blocked.size === 0
    && pending.size === 0
    && duplicates.size === 0
    && !reasons.some((reason) => [
      'certification_identity_missing',
      'git_sha_invalid',
      'deployment_identity_missing',
      'unsupported_certification_exchange',
      'certification_environment_not_live_candidate',
      'certification_time_window_invalid',
      'certification_completion_missing',
      'certification_completion_before_start',
      'required_review_evidence_missing',
    ].includes(reason))

  const certificationPassed = evidenceComplete && certificationCurrent && run.status === 'PASSED'

  return Object.freeze({
    evidenceComplete,
    certificationCurrent,
    certificationPassed,
    certifiedForLive: false,
    reasons: uniqueSorted(reasons),
    missingMandatoryChecks: uniqueSorted(missing),
    failedMandatoryChecks: uniqueSorted(failed),
    blockedMandatoryChecks: uniqueSorted(blocked),
    pendingMandatoryChecks: uniqueSorted(pending),
    duplicateChecks: uniqueSorted(duplicates),
    evaluatedAt: now.toISOString(),
  })
}
