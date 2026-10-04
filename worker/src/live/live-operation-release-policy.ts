import { addDecimal, asDecimalString, compareDecimal } from './decimal.ts'

/** Persisted release evidence, loaded by a trusted coordinator, never request body data. */
export interface OperationReleaseEvidence {
  releaseId: string
  gitSha: string
  workerDeploymentId: string
  frontendDeploymentId: string
  schemaVersion: string
  exchange: string
  accountRefHash: string
  allowedProducts: readonly string[]
  maxOrderNotional: string
  maxDailyNotional: string
  startsAt: string
  expiresAt: string
  status: string
  securityReviewRef: string
  complianceReviewRef: string
}

export interface LiveOperationReleaseInput {
  operation: 'PLACE' | 'CANCEL'
  release: Readonly<OperationReleaseEvidence> | null
  runtime: Readonly<{
    artifact: 'live-execution'
    network: 'mainnet'
    releaseId: string
    gitSha: string
    workerDeploymentId: string
    frontendDeploymentId: string
    schemaVersion: string
    withdrawalsEnabled: false
  }>
  exchange: 'BITGET' | 'BTCC'
  accountRefHash: string
  productId: string
  evaluatedAt: string
  /** PLACE: exact approved conservative quote notional including fees. CANCEL: null. */
  orderNotional: string | null
  /** Includes sent/ambiguous attempts and reservations, not only acknowledged fills. */
  dailyExposure: Readonly<{
    accountRefHash: string
    exchange: string
    utcDay: string
    usedAndReservedNotional: string
  }> | null
}

function canonicalTime(value: unknown): number {
  if (typeof value !== 'string') return NaN
  const ms = Date.parse(value)
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : NaN
}

function present(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.trim() === value
}

/**
 * Scope/limit policy only. Its result is not an execution capability: caller must
 * reload current authority, certify the provider, and atomically claim admission
 * and daily exposure inside the account coordinator before obtaining credentials.
 */
export function evaluateLiveOperationRelease(input: LiveOperationReleaseInput) {
  const { release, runtime } = input
  const now = canonicalTime(input.evaluatedAt)
  const start = canonicalTime(release?.startsAt)
  const expiry = canonicalTime(release?.expiresAt)
  const checks: Record<string, boolean> = {
    operation_supported: input.operation === 'PLACE' || input.operation === 'CANCEL',
    evaluated_at_canonical: Number.isFinite(now),
    executable_artifact: runtime.artifact === 'live-execution',
    mainnet_network: runtime.network === 'mainnet',
    withdrawals_disabled: runtime.withdrawalsEnabled === false,
    release_active: release?.status === 'ACTIVE',
    release_identity_matches: present(runtime.releaseId) && release?.releaseId === runtime.releaseId,
    source_identity_matches: /^[a-f0-9]{40}$/.test(runtime.gitSha) && release?.gitSha === runtime.gitSha,
    worker_deployment_matches: present(runtime.workerDeploymentId) && release?.workerDeploymentId === runtime.workerDeploymentId,
    frontend_deployment_matches: present(runtime.frontendDeploymentId) && release?.frontendDeploymentId === runtime.frontendDeploymentId,
    schema_matches: present(runtime.schemaVersion) && release?.schemaVersion === runtime.schemaVersion,
    exchange_matches: ['BITGET', 'BTCC'].includes(input.exchange) && release?.exchange === input.exchange,
    account_matches: /^[a-f0-9]{64}$/.test(input.accountRefHash) && release?.accountRefHash === input.accountRefHash,
    product_allowed: /^[A-Z0-9]+-[A-Z0-9]+$/.test(input.productId)
      && Array.isArray(release?.allowedProducts) && release.allowedProducts.includes(input.productId),
    release_window_valid: Number.isFinite(now) && Number.isFinite(start) && Number.isFinite(expiry)
      && start < expiry && start <= now && now < expiry,
    security_review_recorded: present(release?.securityReviewRef),
    compliance_review_recorded: present(release?.complianceReviewRef),
    release_limits_valid: false,
    operation_notional_valid: false,
    daily_exposure_bound: input.operation === 'CANCEL',
    daily_limit_satisfied: input.operation === 'CANCEL',
    order_limit_satisfied: input.operation === 'CANCEL',
  }
  try {
    const zero = asDecimalString('0')
    const maxOrder = asDecimalString(release?.maxOrderNotional)
    const maxDaily = asDecimalString(release?.maxDailyNotional)
    checks.release_limits_valid = compareDecimal(maxOrder, zero) > 0
      && compareDecimal(maxDaily, maxOrder) >= 0
    if (input.operation === 'CANCEL') {
      checks.operation_notional_valid = input.orderNotional === null
    } else if (input.operation === 'PLACE') {
      const notional = asDecimalString(input.orderNotional)
      checks.operation_notional_valid = compareDecimal(notional, zero) > 0
      checks.order_limit_satisfied = compareDecimal(notional, maxOrder) <= 0
      const exposure = input.dailyExposure
      checks.daily_exposure_bound = Boolean(exposure
        && exposure.accountRefHash === input.accountRefHash && exposure.exchange === input.exchange
        && exposure.utcDay === input.evaluatedAt.slice(0, 10))
      if (exposure) {
        const used = asDecimalString(exposure.usedAndReservedNotional)
        checks.daily_limit_satisfied = compareDecimal(addDecimal(used, notional), maxDaily) <= 0
      }
    }
  } catch {
    // Missing or malformed financial evidence stays rejected; never coerce to zero.
  }
  const reasons = Object.keys(checks).filter(name => !checks[name])
  return Object.freeze({
    releaseScopeSatisfied: reasons.length === 0,
    checks: Object.freeze(checks),
    reasons: Object.freeze(reasons),
    executionAllowed: false as const,
    withdrawalsAllowed: false as const,
  })
}
