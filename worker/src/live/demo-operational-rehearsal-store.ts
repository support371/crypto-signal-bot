import { canonicalJson } from './canonical-json.ts'
import {
  evaluateOperationalRehearsal,
  type OperationalRehearsalInput,
  type OperationalRehearsalPack,
  type OperationalScenarioEvidence,
} from './demo-operational-rehearsal.ts'

export interface OperationalRehearsalStoreEnv {
  DB: D1Database
}

type PackRow = Record<string, unknown> & {
  pack_id: string
  git_sha: string
  environment: string
  scenarios_json: string
  scenario_count: number
  passed_count: number
  blockers_json: string
  status: string
  ready_for_independent_review: number
  pack_hash: string
  prepared_by: string
  prepared_at: string
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

export class OperationalRehearsalStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationalRehearsalStoreError'
  }
}

function assertLocks(row: PackRow): void {
  if (
    row.environment !== 'BITGET_DEMO_CERTIFICATION'
    || row.scenario_count !== 5
    || row.deployment_allowed !== 0
    || row.demo_request_allowed !== 0
    || row.credentials_read !== 0
    || row.credentials_persisted !== 0
    || row.provider_mutation_allowed !== 0
    || row.execution_allowed !== 0
    || row.live_execution_allowed !== 0
    || row.real_funds_allowed !== 0
    || row.mainnet_allowed !== 0
    || row.withdrawals_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.accounting_automatically_dispatched !== 0
  ) {
    throw new OperationalRehearsalStoreError('stored rehearsal capability locks are invalid')
  }
}

function parseScenarios(value: string): readonly OperationalScenarioEvidence[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new OperationalRehearsalStoreError('stored rehearsal scenarios are malformed')
  }
  if (!Array.isArray(parsed) || parsed.length !== 5) {
    throw new OperationalRehearsalStoreError('stored rehearsal scenarios are invalid')
  }
  return Object.freeze(parsed as OperationalScenarioEvidence[])
}

function rowPack(row: PackRow): OperationalRehearsalPack {
  assertLocks(row)
  let blockers: unknown
  try {
    blockers = JSON.parse(row.blockers_json) as unknown
  } catch {
    throw new OperationalRehearsalStoreError('stored rehearsal blockers are malformed')
  }
  if (!Array.isArray(blockers)) {
    throw new OperationalRehearsalStoreError('stored rehearsal blockers are invalid')
  }
  return Object.freeze({
    packId: row.pack_id,
    gitSha: row.git_sha,
    environment: 'BITGET_DEMO_CERTIFICATION',
    scenarios: parseScenarios(row.scenarios_json),
    scenarioCount: 5,
    passedCount: row.passed_count,
    blockers: Object.freeze(blockers.map(String)),
    status: row.status as OperationalRehearsalPack['status'],
    readyForIndependentReview: row.ready_for_independent_review === 1,
    packHash: row.pack_hash,
    preparedBy: row.prepared_by,
    preparedAt: row.prepared_at,
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

async function loadPack(
  env: OperationalRehearsalStoreEnv,
  packId: string,
  packHash: string,
): Promise<PackRow | null> {
  return env.DB.prepare(`
    SELECT pack_id, git_sha, environment, scenarios_json, scenario_count,
           passed_count, blockers_json, status, ready_for_independent_review,
           pack_hash, prepared_by, prepared_at, deployment_allowed,
           demo_request_allowed, credentials_read, credentials_persisted,
           provider_mutation_allowed, execution_allowed, live_execution_allowed,
           real_funds_allowed, mainnet_allowed, withdrawals_allowed,
           automatic_retry_allowed, accounting_automatically_dispatched
      FROM live_bitget_demo_operational_rehearsal_packs
     WHERE pack_id = ? OR pack_hash = ?
     LIMIT 1
  `).bind(packId, packHash).first<PackRow>()
}

function samePack(left: OperationalRehearsalPack, right: OperationalRehearsalPack): boolean {
  return left.packHash === right.packHash && canonicalJson(left) === canonicalJson(right)
}

export async function recordOperationalRehearsal(
  env: OperationalRehearsalStoreEnv,
  input: OperationalRehearsalInput,
): Promise<OperationalRehearsalPack & { projectionStatus: 'PROJECTED' | 'REPLAYED' }> {
  const pack = await evaluateOperationalRehearsal(input)
  const existing = await loadPack(env, pack.packId, pack.packHash)
  if (existing) {
    const stored = rowPack(existing)
    if (!samePack(stored, pack)) {
      throw new OperationalRehearsalStoreError('stored rehearsal pack conflicts with current evidence')
    }
    return Object.freeze({ ...pack, projectionStatus: 'REPLAYED' as const })
  }

  try {
    await env.DB.prepare(`
      INSERT INTO live_bitget_demo_operational_rehearsal_packs (
        pack_id, git_sha, environment, scenarios_json, scenario_count,
        passed_count, blockers_json, status, ready_for_independent_review,
        pack_hash, prepared_by, prepared_at, deployment_allowed,
        demo_request_allowed, credentials_read, credentials_persisted,
        provider_mutation_allowed, execution_allowed, live_execution_allowed,
        real_funds_allowed, mainnet_allowed, withdrawals_allowed,
        automatic_retry_allowed, accounting_automatically_dispatched
      ) VALUES (
        ?, ?, 'BITGET_DEMO_CERTIFICATION', ?, 5, ?, ?, ?, ?, ?, ?, ?,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
      )
    `).bind(
      pack.packId,
      pack.gitSha,
      canonicalJson(pack.scenarios),
      pack.passedCount,
      canonicalJson(pack.blockers),
      pack.status,
      pack.readyForIndependentReview ? 1 : 0,
      pack.packHash,
      pack.preparedBy,
      pack.preparedAt,
    ).run()
  } catch {
    throw new OperationalRehearsalStoreError('immutable rehearsal insert was rejected')
  }

  const storedRow = await loadPack(env, pack.packId, pack.packHash)
  if (!storedRow) throw new OperationalRehearsalStoreError('rehearsal pack is missing after insert')
  const stored = rowPack(storedRow)
  if (!samePack(stored, pack)) {
    throw new OperationalRehearsalStoreError('stored rehearsal pack failed verification')
  }
  return Object.freeze({ ...pack, projectionStatus: 'PROJECTED' as const })
}
