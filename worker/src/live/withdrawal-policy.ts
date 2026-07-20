import {
  addDecimal,
  compareDecimal,
  isPositiveDecimal,
  type DecimalString,
} from './decimal.ts'

export interface WithdrawalDestinationEvidence {
  destinationId: string
  exchangeAccountId: string
  asset: string
  network: string
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED'
  screeningStatus: 'PENDING' | 'CLEAR' | 'BLOCKED' | 'EXPIRED' | 'REVIEW_REQUIRED'
  activatesAt: string
  expiresAt: string | null
}

export interface WithdrawalApprovalEvidence {
  approverId: string
  approvalRole: 'WITHDRAWAL_APPROVER' | 'RISK_ADMIN'
  decision: 'APPROVE' | 'REJECT'
  decidedAt: string
  stepUpValid: boolean
}

export interface WithdrawalPolicyLimits {
  minimumAmount: DecimalString
  maximumAmount: DecimalString
  maximumDailyAmount: DecimalString
  requiredApprovalCount: number
  requiredApprovalRoles: readonly WithdrawalApprovalEvidence['approvalRole'][]
  minimumTimeLockMs: number
}

export interface WithdrawalPolicyInput {
  withdrawalId: string
  exchangeAccountId: string
  requesterId: string
  asset: string
  network: string
  amount: DecimalString
  estimatedFee: DecimalString
  availableBalance: DecimalString
  dailyCompletedAmount: DecimalString
  requestedAt: string
  evaluatedAt: string
  releaseAt: string | null
  destination: WithdrawalDestinationEvidence | null
  approvals: readonly WithdrawalApprovalEvidence[]
  accountEligible: boolean
  releaseActive: boolean
  guardianClear: boolean
  reconciliationClear: boolean
  idempotencyClaimed: boolean
  providerCapabilityConfirmed: boolean
  withdrawalsEnabled: boolean
  candidateBuildLocked: boolean
  limits: WithdrawalPolicyLimits
}

export interface WithdrawalPolicyDecision {
  allowed: boolean
  reasons: readonly string[]
  checks: Readonly<Record<string, boolean>>
  projectedDailyAmount: DecimalString
  requiredBalance: DecimalString
  distinctApprovers: readonly string[]
  approvalRoles: readonly WithdrawalApprovalEvidence['approvalRole'][]
  evaluatedAt: string
}

function validTimestamp(value: string): boolean {
  return Boolean(value) && Number.isFinite(Date.parse(value))
}

function normalizedText(value: string): string {
  return value.trim().toUpperCase()
}

export function evaluateWithdrawalPolicy(
  input: WithdrawalPolicyInput,
): WithdrawalPolicyDecision {
  if (!input.withdrawalId.trim()) throw new TypeError('withdrawalId is required')
  if (!input.exchangeAccountId.trim()) throw new TypeError('exchangeAccountId is required')
  if (!input.requesterId.trim()) throw new TypeError('requesterId is required')
  if (!validTimestamp(input.requestedAt)) throw new TypeError('requestedAt must be ISO-8601')
  if (!validTimestamp(input.evaluatedAt)) throw new TypeError('evaluatedAt must be ISO-8601')
  if (!Number.isInteger(input.limits.requiredApprovalCount) || input.limits.requiredApprovalCount < 2) {
    throw new RangeError('requiredApprovalCount must be at least two')
  }
  if (!Number.isInteger(input.limits.minimumTimeLockMs) || input.limits.minimumTimeLockMs < 0) {
    throw new RangeError('minimumTimeLockMs must be a non-negative integer')
  }

  const evaluatedAtMs = Date.parse(input.evaluatedAt)
  const requestedAtMs = Date.parse(input.requestedAt)
  const projectedDailyAmount = addDecimal(input.dailyCompletedAmount, input.amount)
  const requiredBalance = addDecimal(input.amount, input.estimatedFee)
  const activeApprovals = input.approvals.filter((approval) => {
    if (approval.decision !== 'APPROVE' || !approval.stepUpValid) return false
    if (!validTimestamp(approval.decidedAt)) return false
    return Date.parse(approval.decidedAt) <= evaluatedAtMs
  })
  const distinctApprovers = Array.from(new Set(activeApprovals.map((approval) => approval.approverId)))
  const approvalRoles = Array.from(new Set(activeApprovals.map((approval) => approval.approvalRole)))
  const rejectionPresent = input.approvals.some((approval) => approval.decision === 'REJECT')
  const requesterSelfApproved = distinctApprovers.includes(input.requesterId)

  const destination = input.destination
  const destinationMatches = Boolean(
    destination
      && destination.exchangeAccountId === input.exchangeAccountId
      && normalizedText(destination.asset) === normalizedText(input.asset)
      && normalizedText(destination.network) === normalizedText(input.network),
  )
  const destinationActive = Boolean(
    destination
      && destination.status === 'ACTIVE'
      && destination.screeningStatus === 'CLEAR'
      && validTimestamp(destination.activatesAt)
      && Date.parse(destination.activatesAt) <= evaluatedAtMs
      && (
        destination.expiresAt === null
        || (validTimestamp(destination.expiresAt) && Date.parse(destination.expiresAt) > evaluatedAtMs)
      ),
  )
  const releaseAtValid = Boolean(
    input.releaseAt
      && validTimestamp(input.releaseAt)
      && Date.parse(input.releaseAt) <= evaluatedAtMs
      && Date.parse(input.releaseAt) >= requestedAtMs + input.limits.minimumTimeLockMs,
  )
  const requiredRolesPresent = input.limits.requiredApprovalRoles.every(
    (requiredRole) => approvalRoles.includes(requiredRole),
  )

  const checks: Record<string, boolean> = {
    candidate_build_unlocked: !input.candidateBuildLocked,
    withdrawals_enabled: input.withdrawalsEnabled,
    account_eligible: input.accountEligible,
    release_active: input.releaseActive,
    guardian_clear: input.guardianClear,
    reconciliation_clear: input.reconciliationClear,
    idempotency_claimed: input.idempotencyClaimed,
    provider_capability_confirmed: input.providerCapabilityConfirmed,
    amount_positive: isPositiveDecimal(input.amount),
    amount_at_or_above_minimum:
      compareDecimal(input.amount, input.limits.minimumAmount) >= 0,
    amount_at_or_below_maximum:
      compareDecimal(input.amount, input.limits.maximumAmount) <= 0,
    projected_daily_amount_within_limit:
      compareDecimal(projectedDailyAmount, input.limits.maximumDailyAmount) <= 0,
    available_balance_sufficient:
      compareDecimal(input.availableBalance, requiredBalance) >= 0,
    destination_present: destination !== null,
    destination_matches_request: destinationMatches,
    destination_active_and_screened: destinationActive,
    no_rejection_present: !rejectionPresent,
    requester_did_not_self_approve: !requesterSelfApproved,
    enough_distinct_approvers:
      distinctApprovers.length >= input.limits.requiredApprovalCount,
    required_approval_roles_present: requiredRolesPresent,
    time_lock_satisfied: releaseAtValid,
  }

  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)

  return {
    allowed: reasons.length === 0,
    reasons,
    checks,
    projectedDailyAmount,
    requiredBalance,
    distinctApprovers,
    approvalRoles,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
  }
}
