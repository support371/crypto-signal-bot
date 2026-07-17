import {
  asDecimalString,
  type LiveReadinessReport,
  type ReleaseAuthorization,
} from './domain'

export interface LiveGateEnv {
  DB: D1Database
  TRADING_MODE?: string
  EXCHANGE_MODE?: string
  NETWORK?: string
  ALLOW_MAINNET?: string
  LIVE_EXECUTION_ENABLED?: string
  LIVE_RELEASE_ID?: string
  BUILD_GIT_SHA?: string
  WITHDRAWALS_ENABLED?: string
  CANDIDATE_RESOURCES_CONFIGURED?: string
}

type ReleaseRow = {
  release_id: string
  git_sha: string
  worker_deployment_id: string
  frontend_deployment_id: string
  schema_version: string
  exchange_name: string
  account_ref_hash: string
  allowed_products_json: string
  max_order_notional: string
  max_daily_notional: string
  starts_at: string
  expires_at: string
  status: string
  security_review_ref: string
  compliance_review_ref: string
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function normalized(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

function enabled(value: unknown): boolean {
  return TRUE_VALUES.has(normalized(value))
}

function parseAllowedProducts(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => String(item).trim().toUpperCase())
      .filter((item) => item.length > 0)
  } catch {
    return []
  }
}

function validIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value))
}

function rowToAuthorization(row: ReleaseRow): ReleaseAuthorization | null {
  const status = row.status.toUpperCase()
  if (!['PENDING', 'ACTIVE', 'REVOKED', 'EXPIRED'].includes(status)) return null
  if (!validIsoTimestamp(row.starts_at) || !validIsoTimestamp(row.expires_at)) return null

  try {
    return {
      releaseId: row.release_id,
      gitSha: row.git_sha,
      workerDeploymentId: row.worker_deployment_id,
      frontendDeploymentId: row.frontend_deployment_id,
      schemaVersion: row.schema_version,
      exchange: row.exchange_name,
      accountRefHash: row.account_ref_hash,
      allowedProducts: parseAllowedProducts(row.allowed_products_json),
      maxOrderNotional: asDecimalString(row.max_order_notional, 'max_order_notional'),
      maxDailyNotional: asDecimalString(row.max_daily_notional, 'max_daily_notional'),
      startsAt: row.starts_at,
      expiresAt: row.expires_at,
      status: status as ReleaseAuthorization['status'],
      securityReviewRef: row.security_review_ref,
      complianceReviewRef: row.compliance_review_ref,
    }
  } catch {
    return null
  }
}

export async function loadReleaseAuthorization(
  env: LiveGateEnv,
  releaseId: string,
): Promise<ReleaseAuthorization | null> {
  if (!releaseId) return null

  try {
    const row = await env.DB.prepare(
      `SELECT release_id, git_sha, worker_deployment_id, frontend_deployment_id,
              schema_version, exchange_name, account_ref_hash,
              allowed_products_json, max_order_notional, max_daily_notional,
              starts_at, expires_at, status, security_review_ref,
              compliance_review_ref
         FROM release_authorizations
        WHERE release_id = ?
        LIMIT 1`,
    ).bind(releaseId).first<ReleaseRow>()

    return row ? rowToAuthorization(row) : null
  } catch {
    return null
  }
}

export async function evaluateLiveCandidateReadiness(
  env: LiveGateEnv,
  now = new Date(),
): Promise<LiveReadinessReport & {
  authorizationEvidenceSatisfied: boolean
  activationPrerequisitesSatisfied: boolean
}> {
  const configuredReleaseId = String(env.LIVE_RELEASE_ID ?? '').trim()
  const gitSha = String(env.BUILD_GIT_SHA ?? '').trim()
  const release = await loadReleaseAuthorization(env, configuredReleaseId)
  const nowMs = now.getTime()

  const releaseWindowValid = Boolean(
    release
      && Date.parse(release.startsAt) <= nowMs
      && Date.parse(release.expiresAt) > nowMs,
  )

  const checks: Record<string, boolean> = {
    candidate_mode: normalized(env.TRADING_MODE) === 'live-candidate',
    exchange_candidate_mode: normalized(env.EXCHANGE_MODE) === 'live-candidate',
    mainnet_network_requested: normalized(env.NETWORK) === 'mainnet',
    explicit_mainnet_flag: enabled(env.ALLOW_MAINNET),
    explicit_live_execution_flag: enabled(env.LIVE_EXECUTION_ENABLED),
    withdrawals_disabled: !enabled(env.WITHDRAWALS_ENABLED),
    isolated_candidate_resources_configured: enabled(env.CANDIDATE_RESOURCES_CONFIGURED),
    build_git_sha_present: gitSha.length >= 40,
    release_id_present: configuredReleaseId.length > 0,
    release_record_found: release !== null,
    release_active: release?.status === 'ACTIVE',
    release_window_valid: releaseWindowValid,
    release_git_sha_matches: Boolean(release && gitSha && release.gitSha === gitSha),
    security_review_recorded: Boolean(release?.securityReviewRef),
    compliance_review_recorded: Boolean(release?.complianceReviewRef),
    product_allowlist_present: Boolean(release?.allowedProducts.length),
    deployment_ids_present: Boolean(
      release?.workerDeploymentId && release?.frontendDeploymentId,
    ),
    candidate_execution_path_locked: true,
  }

  const authorizationEvidenceSatisfied = Object.entries(checks)
    .filter(([name]) => name !== 'candidate_execution_path_locked')
    .every(([, passed]) => passed)

  const reasons = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)

  // Candidate artifacts are certification inputs only. They can never execute.
  reasons.push('candidate_build_cannot_execute_live_orders')

  return {
    liveReady: false,
    withdrawalsReady: false,
    environment: 'live-candidate',
    reasons,
    checks,
    releaseId: release?.releaseId ?? null,
    gitSha,
    evaluatedAt: now.toISOString(),
    authorizationEvidenceSatisfied,
    activationPrerequisitesSatisfied: authorizationEvidenceSatisfied,
  }
}
