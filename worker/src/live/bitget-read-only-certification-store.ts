import { canonicalHash } from './canonical-json.ts'
import type {
  BitgetReadOnlyCertificationCheck,
  BitgetReadOnlyCertificationResult,
  BitgetReadOnlyCertificationStatus,
} from './bitget-read-only-certification.ts'

export interface BitgetReadOnlyCertificationStoreEnv {
  DB: D1Database
}

export interface PersistBitgetReadOnlyCertificationResult {
  persistenceStatus: 'PROJECTED' | 'REPLAYED'
  runId: string
  evidenceHash: string
  certificationStatus: BitgetReadOnlyCertificationStatus
  readOnlyEvidenceComplete: boolean
  certifiedForLive: false
  providerMutationAllowed: false
  automaticRetryAllowed: false
  transferAllowed: false
  withdrawalAllowed: false
  executionAllowed: false
  credentialsPersisted: false
}

export class BitgetReadOnlyCertificationConflictError extends Error {
  readonly code = 'BITGET_READ_ONLY_CERTIFICATION_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'BitgetReadOnlyCertificationConflictError'
  }
}

type RunRow = {
  run_id: string
  provider: 'BITGET'
  exchange_account_id: string
  product_id: string
  status: BitgetReadOnlyCertificationStatus
  read_only_evidence_complete: number
  permissions_verified: number
  product_count: number
  balance_count: number
  current_order_count: number
  history_order_count: number
  fill_count: number
  duplicate_order_count: number
  duplicate_fill_count: number
  evaluated_at: string
  evidence_hash: string
  certified_for_live: number
  provider_mutation_allowed: number
  automatic_retry_allowed: number
  transfer_allowed: number
  withdrawal_allowed: number
  execution_allowed: number
  credentials_persisted: number
}

type CheckRow = {
  run_id: string
  check_name: BitgetReadOnlyCertificationCheck['name']
  status: BitgetReadOnlyCertificationCheck['status']
  reason: string | null
  evidence_hash: string
}

const CHECK_NAMES = Object.freeze([
  'READ_ONLY_PERMISSIONS',
  'PRODUCT_CONTRACT',
  'BALANCE_CONTRACT',
  'CURRENT_ORDER_CONTRACT',
  'ORDER_HISTORY_CONTRACT',
  'FILL_CONTRACT',
  'PAGINATION_BOUNDARY',
  'RECOVERY_IDENTITY_CONSISTENCY',
] as const satisfies readonly BitgetReadOnlyCertificationCheck['name'][])
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function sha256(value: string, field: string): string {
  const normalized = required(value, field).toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${field} must be a SHA-256 hash`)
  return normalized
}

function isoTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function expectedStatus(
  checks: readonly BitgetReadOnlyCertificationCheck[],
): BitgetReadOnlyCertificationStatus {
  if (checks.some((check) => check.status === 'FAIL')) return 'FAILED'
  if (checks.some((check) => check.status === 'BLOCKED')) return 'BLOCKED'
  return 'PASSED'
}

function orderedChecks(
  checks: readonly BitgetReadOnlyCertificationCheck[],
): readonly BitgetReadOnlyCertificationCheck[] {
  if (checks.length !== CHECK_NAMES.length) {
    throw new BitgetReadOnlyCertificationConflictError(
      'Bitget read-only certification must contain exactly eight checks',
    )
  }
  const byName = new Map<BitgetReadOnlyCertificationCheck['name'], BitgetReadOnlyCertificationCheck>()
  for (const check of checks) {
    if (byName.has(check.name)) {
      throw new BitgetReadOnlyCertificationConflictError(
        `duplicate Bitget read-only certification check: ${check.name}`,
      )
    }
    sha256(check.evidenceHash, `check evidence hash:${check.name}`)
    byName.set(check.name, Object.freeze({ ...check }))
  }
  const result = CHECK_NAMES.map((name) => byName.get(name))
  if (result.some((check) => check === undefined)) {
    throw new BitgetReadOnlyCertificationConflictError(
      'Bitget read-only certification is missing a mandatory check',
    )
  }
  return Object.freeze(result as BitgetReadOnlyCertificationCheck[])
}

function assertCapabilityLocks(result: BitgetReadOnlyCertificationResult): void {
  if (
    result.certifiedForLive !== false
    || result.providerMutationAllowed !== false
    || result.automaticRetryAllowed !== false
    || result.transferAllowed !== false
    || result.withdrawalAllowed !== false
    || result.executionAllowed !== false
    || result.credentialsPersisted !== false
  ) {
    throw new BitgetReadOnlyCertificationConflictError(
      'Bitget read-only certification violates permanent capability locks',
    )
  }
}

function assertStoredCapabilityLocks(row: RunRow): void {
  if (
    row.certified_for_live !== 0
    || row.provider_mutation_allowed !== 0
    || row.automatic_retry_allowed !== 0
    || row.transfer_allowed !== 0
    || row.withdrawal_allowed !== 0
    || row.execution_allowed !== 0
    || row.credentials_persisted !== 0
  ) {
    throw new BitgetReadOnlyCertificationConflictError(
      'stored Bitget read-only certification violates permanent capability locks',
    )
  }
}

async function expectedEvidenceHash(
  result: BitgetReadOnlyCertificationResult,
  checks: readonly BitgetReadOnlyCertificationCheck[],
): Promise<string> {
  return canonicalHash({
    runId: result.runId,
    provider: result.provider,
    exchangeAccountId: result.exchangeAccountId,
    productId: result.productId,
    status: result.status,
    permissionsVerified: result.permissionsVerified,
    productCount: result.productCount,
    balanceCount: result.balanceCount,
    currentOrderCount: result.currentOrderCount,
    historyOrderCount: result.historyOrderCount,
    fillCount: result.fillCount,
    duplicateOrderCount: result.duplicateOrderCount,
    duplicateFillCount: result.duplicateFillCount,
    checks,
    evaluatedAt: result.evaluatedAt,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  })
}

async function validateResult(
  result: BitgetReadOnlyCertificationResult,
): Promise<readonly BitgetReadOnlyCertificationCheck[]> {
  required(result.runId, 'runId')
  required(result.exchangeAccountId, 'exchangeAccountId')
  required(result.productId, 'productId')
  if (result.provider !== 'BITGET') throw new TypeError('provider must be BITGET')
  isoTimestamp(result.evaluatedAt, 'evaluatedAt')
  assertCapabilityLocks(result)
  const checks = orderedChecks(result.checks)
  const derivedStatus = expectedStatus(checks)
  if (
    result.status !== derivedStatus
    || result.readOnlyEvidenceComplete !== (derivedStatus === 'PASSED')
    || (result.status === 'PASSED' && !result.permissionsVerified)
  ) {
    throw new BitgetReadOnlyCertificationConflictError(
      'Bitget read-only certification status conflicts with its checks',
    )
  }
  for (const value of [
    result.productCount,
    result.balanceCount,
    result.currentOrderCount,
    result.historyOrderCount,
    result.fillCount,
    result.duplicateOrderCount,
    result.duplicateFillCount,
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('Bitget read-only certification counts must be non-negative safe integers')
    }
  }
  const suppliedHash = sha256(result.evidenceHash, 'evidenceHash')
  if (await expectedEvidenceHash(result, checks) !== suppliedHash) {
    throw new BitgetReadOnlyCertificationConflictError(
      'Bitget read-only certification evidence hash is invalid',
    )
  }
  return checks
}

async function loadRun(
  env: BitgetReadOnlyCertificationStoreEnv,
  runId: string,
  evidenceHash: string,
): Promise<RunRow | null> {
  return env.DB.prepare(`
    SELECT run_id, provider, exchange_account_id, product_id, status,
           read_only_evidence_complete, permissions_verified, product_count,
           balance_count, current_order_count, history_order_count, fill_count,
           duplicate_order_count, duplicate_fill_count, evaluated_at,
           evidence_hash, certified_for_live, provider_mutation_allowed,
           automatic_retry_allowed, transfer_allowed, withdrawal_allowed,
           execution_allowed, credentials_persisted
      FROM live_bitget_read_only_certification_runs
     WHERE run_id = ? OR evidence_hash = ?
     LIMIT 1
  `).bind(runId, evidenceHash).first<RunRow>()
}

async function loadChecks(
  env: BitgetReadOnlyCertificationStoreEnv,
  runId: string,
): Promise<readonly CheckRow[]> {
  const result = await env.DB.prepare(`
    SELECT run_id, check_name, status, reason, evidence_hash
      FROM live_bitget_read_only_certification_checks
     WHERE run_id = ?
     ORDER BY check_name ASC
  `).bind(runId).all<CheckRow>()
  return Object.freeze([...(result.results ?? [])])
}

function assertRunCompatible(
  row: RunRow,
  result: BitgetReadOnlyCertificationResult,
): void {
  assertStoredCapabilityLocks(row)
  if (
    row.run_id !== result.runId
    || row.provider !== 'BITGET'
    || row.exchange_account_id !== result.exchangeAccountId
    || row.product_id !== result.productId
    || row.status !== result.status
    || row.read_only_evidence_complete !== (result.readOnlyEvidenceComplete ? 1 : 0)
    || row.permissions_verified !== (result.permissionsVerified ? 1 : 0)
    || row.product_count !== result.productCount
    || row.balance_count !== result.balanceCount
    || row.current_order_count !== result.currentOrderCount
    || row.history_order_count !== result.historyOrderCount
    || row.fill_count !== result.fillCount
    || row.duplicate_order_count !== result.duplicateOrderCount
    || row.duplicate_fill_count !== result.duplicateFillCount
    || row.evaluated_at !== result.evaluatedAt
    || row.evidence_hash !== result.evidenceHash
  ) {
    throw new BitgetReadOnlyCertificationConflictError(
      'stored Bitget read-only certification conflicts with supplied evidence',
    )
  }
}

function assertChecksCompatible(
  rows: readonly CheckRow[],
  checks: readonly BitgetReadOnlyCertificationCheck[],
  runId: string,
): void {
  if (rows.length !== checks.length) {
    throw new BitgetReadOnlyCertificationConflictError(
      'stored Bitget read-only certification checks are incomplete',
    )
  }
  const byName = new Map(rows.map((row) => [row.check_name, row]))
  for (const check of checks) {
    const row = byName.get(check.name)
    if (
      !row
      || row.run_id !== runId
      || row.status !== check.status
      || row.reason !== check.reason
      || row.evidence_hash !== check.evidenceHash
    ) {
      throw new BitgetReadOnlyCertificationConflictError(
        `stored Bitget read-only certification check conflicts: ${check.name}`,
      )
    }
  }
}

function persistenceResult(
  persistenceStatus: PersistBitgetReadOnlyCertificationResult['persistenceStatus'],
  result: BitgetReadOnlyCertificationResult,
): PersistBitgetReadOnlyCertificationResult {
  return Object.freeze({
    persistenceStatus,
    runId: result.runId,
    evidenceHash: result.evidenceHash,
    certificationStatus: result.status,
    readOnlyEvidenceComplete: result.readOnlyEvidenceComplete,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  })
}

export async function persistBitgetReadOnlyCertification(
  env: BitgetReadOnlyCertificationStoreEnv,
  result: BitgetReadOnlyCertificationResult,
): Promise<PersistBitgetReadOnlyCertificationResult> {
  const checks = await validateResult(result)
  const existing = await loadRun(env, result.runId, result.evidenceHash)
  if (existing) {
    assertRunCompatible(existing, result)
    assertChecksCompatible(await loadChecks(env, existing.run_id), checks, result.runId)
    return persistenceResult('REPLAYED', result)
  }

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(`
      INSERT INTO live_bitget_read_only_certification_runs (
        run_id, provider, exchange_account_id, product_id, status,
        read_only_evidence_complete, permissions_verified, product_count,
        balance_count, current_order_count, history_order_count, fill_count,
        duplicate_order_count, duplicate_fill_count, evaluated_at, evidence_hash,
        certified_for_live, provider_mutation_allowed, automatic_retry_allowed,
        transfer_allowed, withdrawal_allowed, execution_allowed,
        credentials_persisted
      ) VALUES (?, 'BITGET', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0)
    `).bind(
      result.runId,
      result.exchangeAccountId,
      result.productId,
      result.status,
      result.readOnlyEvidenceComplete ? 1 : 0,
      result.permissionsVerified ? 1 : 0,
      result.productCount,
      result.balanceCount,
      result.currentOrderCount,
      result.historyOrderCount,
      result.fillCount,
      result.duplicateOrderCount,
      result.duplicateFillCount,
      result.evaluatedAt,
      result.evidenceHash,
    ),
    ...checks.map((item) => env.DB.prepare(`
      INSERT INTO live_bitget_read_only_certification_checks (
        run_id, check_name, status, reason, evidence_hash
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(
      result.runId,
      item.name,
      item.status,
      item.reason,
      item.evidenceHash,
    )),
  ]
  await env.DB.batch(statements)

  const projectedRun = await loadRun(env, result.runId, result.evidenceHash)
  if (!projectedRun) throw new Error('Bitget read-only certification run is missing after D1 batch')
  assertRunCompatible(projectedRun, result)
  assertChecksCompatible(await loadChecks(env, result.runId), checks, result.runId)
  return persistenceResult('PROJECTED', result)
}
