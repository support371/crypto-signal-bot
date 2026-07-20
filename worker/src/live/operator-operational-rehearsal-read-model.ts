export interface OperatorOperationalRehearsalEnv {
  DB: D1Database
}

type OperationalRehearsalRow = {
  git_sha: string
  environment: 'BITGET_DEMO_CERTIFICATION'
  scenarios_json: string
  scenario_count: number
  passed_count: number
  blockers_json: string
  status: 'BLOCKED' | 'READY_FOR_INDEPENDENT_REVIEW'
  ready_for_independent_review: number
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

function strings(value: string, limit: number): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return Object.freeze(['invalid_evidence'])
    return Object.freeze(parsed
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0)
      .slice(0, limit))
  } catch {
    return Object.freeze(['invalid_evidence'])
  }
}

function scenarios(value: string): readonly Readonly<{
  name: string
  passed: boolean
  evidencePresent: boolean
  observedAt: string | null
}>[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return Object.freeze([])
    return Object.freeze(parsed.slice(0, 5).map((item) => {
      const row = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {}
      return Object.freeze({
        name: typeof row.name === 'string' ? row.name : 'INVALID_SCENARIO',
        passed: row.passed === true,
        evidencePresent: row.evidencePresent === true,
        observedAt: typeof row.observedAt === 'string' ? row.observedAt : null,
      })
    }))
  } catch {
    return Object.freeze([])
  }
}

function locksValid(row: OperationalRehearsalRow): boolean {
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

export async function readLatestOperationalRehearsal(
  env: OperatorOperationalRehearsalEnv,
): Promise<unknown | null> {
  const row = await env.DB.prepare(`
    SELECT git_sha, environment, scenarios_json, scenario_count,
           passed_count, blockers_json, status, ready_for_independent_review,
           prepared_at, created_at, deployment_allowed, demo_request_allowed,
           credentials_read, credentials_persisted, provider_mutation_allowed,
           execution_allowed, live_execution_allowed, real_funds_allowed,
           mainnet_allowed, withdrawals_allowed, automatic_retry_allowed,
           accounting_automatically_dispatched
      FROM live_bitget_demo_operational_rehearsal_packs
     ORDER BY prepared_at DESC, created_at DESC
     LIMIT 1
  `).first<OperationalRehearsalRow>()
  if (!row) return null

  const lockState = locksValid(row)
  const scenarioCount = Number.isSafeInteger(row.scenario_count) ? Math.max(0, row.scenario_count) : 0
  const passedCount = Number.isSafeInteger(row.passed_count)
    ? Math.min(scenarioCount, Math.max(0, row.passed_count))
    : 0
  const blockerList = strings(row.blockers_json, 5)

  return Object.freeze({
    environment: row.environment,
    status: lockState ? row.status : 'BLOCKED',
    readyForIndependentReview: lockState
      && row.ready_for_independent_review === 1
      && row.status === 'READY_FOR_INDEPENDENT_REVIEW',
    checks: Object.freeze({
      total: scenarioCount,
      passed: passedCount,
      blocked: Math.max(0, scenarioCount - passedCount),
    }),
    scenarios: scenarios(row.scenarios_json),
    blockers: lockState ? blockerList : Object.freeze([
      ...blockerList,
      'stored_capability_lock_violation',
    ]),
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
