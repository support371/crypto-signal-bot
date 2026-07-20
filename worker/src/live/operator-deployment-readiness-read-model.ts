export interface OperatorDeploymentReadinessEnv {
  DB: D1Database
}

type DeploymentReadinessRow = {
  git_sha: string
  environment: 'BITGET_DEMO_CERTIFICATION'
  external_attestation_id: string | null
  check_count: number
  passed_count: number
  blockers_json: string
  status: 'BLOCKED' | 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW'
  ready_for_non_live_deployment_review: number
  prepared_at: string
  created_at: string
  deployment_allowed: number
  demo_request_allowed: number
  credentials_read: number
  credentials_persisted: number
  provider_mutation_allowed: number
  execution_allowed: number
  live_execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
  automatic_retry_allowed: number
  accounting_automatically_dispatched: number
}

function parseBlockers(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return Object.freeze(['invalid_blocker_evidence'])
    return Object.freeze(parsed
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0)
      .slice(0, 14))
  } catch {
    return Object.freeze(['invalid_blocker_evidence'])
  }
}

function capabilityLocksValid(row: DeploymentReadinessRow): boolean {
  return row.deployment_allowed === 0
    && row.demo_request_allowed === 0
    && row.credentials_read === 0
    && row.credentials_persisted === 0
    && row.provider_mutation_allowed === 0
    && row.execution_allowed === 0
    && row.live_execution_allowed === 0
    && row.real_funds_allowed === 0
    && row.mainnet_allowed === 0
    && row.withdrawals_allowed === 0
    && row.automatic_retry_allowed === 0
    && row.accounting_automatically_dispatched === 0
}

export async function readLatestBitgetDemoDeploymentReadiness(
  env: OperatorDeploymentReadinessEnv,
): Promise<unknown | null> {
  const row = await env.DB.prepare(`
    SELECT git_sha, environment, external_attestation_id,
           check_count, passed_count, blockers_json, status,
           ready_for_non_live_deployment_review, prepared_at, created_at,
           deployment_allowed, demo_request_allowed, credentials_read,
           credentials_persisted, provider_mutation_allowed,
           execution_allowed, live_execution_allowed, real_funds_allowed,
           mainnet_allowed, withdrawals_allowed, automatic_retry_allowed,
           accounting_automatically_dispatched
      FROM live_bitget_demo_deployment_readiness_manifests
     ORDER BY prepared_at DESC, created_at DESC
     LIMIT 1
  `).first<DeploymentReadinessRow>()
  if (!row) return null

  const blockers = parseBlockers(row.blockers_json)
  const locksValid = capabilityLocksValid(row)
  const checkCount = Number.isSafeInteger(row.check_count) && row.check_count >= 0
    ? row.check_count
    : 0
  const passedCount = Number.isSafeInteger(row.passed_count)
    ? Math.min(checkCount, Math.max(0, row.passed_count))
    : 0

  return Object.freeze({
    environment: row.environment,
    status: locksValid ? row.status : 'BLOCKED',
    readyForNonLiveDeploymentReview: locksValid
      && row.ready_for_non_live_deployment_review === 1
      && row.status === 'READY_FOR_NON_LIVE_DEPLOYMENT_REVIEW',
    checks: Object.freeze({
      total: checkCount,
      passed: passedCount,
      blocked: Math.max(0, checkCount - passedCount),
    }),
    blockers: locksValid ? blockers : Object.freeze([
      ...blockers,
      'stored_capability_lock_violation',
    ]),
    externalReadOnlyAttestationPresent: row.external_attestation_id !== null,
    gitSha: row.git_sha,
    preparedAt: row.prepared_at,
    createdAt: row.created_at,
    deploymentAllowed: false,
    demoRequestAllowed: false,
    credentialsRead: false,
    credentialsPersisted: false,
    providerMutationAllowed: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
    accountingAutomaticallyDispatched: false,
  })
}
