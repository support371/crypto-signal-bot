/**
 * Bitget UTA V3 read-only certification harness.
 *
 * Runs the step-1 certification checks against a `BitgetV3ReadOnlyClient`
 * (mock fixtures shaped from the UTA docs, or the live read-only endpoints
 * once Gem provides a read-only UTA key). Every check records PASS / FAIL /
 * BLOCKED with an evidence hash, runId, and measured latency.
 *
 * This harness can never certify anything for live execution: the result type
 * hardcodes certifiedForLive/providerMutationAllowed/executionAllowed (and
 * friends) to false, mirroring the V2 certification result shape.
 */
import { canonicalHash } from '../../../canonical-json.ts'
import {
  assertBitgetV3ReadOnlyRequest,
  BITGET_V3_ENDPOINTS,
} from './endpoints-v3.ts'
import {
  BitgetV3ReadOnlyAdapter,
  type BitgetV3PositionSnapshot,
  type BitgetV3UnifiedAccountSnapshot,
} from './normalizer-v3.ts'
import type {
  BitgetV3AccountPermissions,
  BitgetV3ReadOnlyEndpoint,
} from './read-only-client-v3.ts'
import type { ExchangeProduct } from '../../../exchange-contracts.ts'

export type BitgetV3CertificationCheckStatus = 'PASS' | 'FAIL' | 'BLOCKED'
export type BitgetV3CertificationStatus = 'PASSED' | 'FAILED' | 'BLOCKED'

export interface BitgetV3ReadOnlyCertificationClient {
  verifyReadOnlyPermissions(): Promise<BitgetV3AccountPermissions>
  getAccountAssets(): Promise<unknown>
  getCurrentPositions(
    query?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>
  getInstruments(category: unknown): Promise<unknown>
  request(
    endpoint: BitgetV3ReadOnlyEndpoint,
    query?: Readonly<Record<string, string | number | boolean | null | undefined>>,
  ): Promise<unknown>
}

export interface BitgetV3ReadOnlyCertificationInput {
  runId: string
  exchangeAccountId: string
  observedAt: string
  productExpiresAt: string
  evaluatedAt: string
  client: BitgetV3ReadOnlyCertificationClient
  adapter?: BitgetV3ReadOnlyAdapter
}

export interface BitgetV3ReadOnlyCertificationCheck {
  name:
    | 'READ_ONLY_PERMISSIONS'
    | 'ACCOUNT_ASSETS_CONTRACT'
    | 'POSITION_CONTRACT'
    | 'INSTRUMENTS_CONTRACT'
    | 'READ_ONLY_ENFORCEMENT'
  status: BitgetV3CertificationCheckStatus
  reason: string | null
  latencyMs: number
  evidenceHash: string
}

export interface BitgetV3ReadOnlyCertificationResult {
  runId: string
  provider: 'BITGET'
  apiVersion: 'V3'
  exchangeAccountId: string
  status: BitgetV3CertificationStatus
  checks: readonly BitgetV3ReadOnlyCertificationCheck[]
  evaluatedAt: string
  evidenceHash: string
  unifiedAccountSnapshot: BitgetV3UnifiedAccountSnapshot | null
  positionCount: number
  productCount: number
  certifiedForLive: false
  providerMutationAllowed: false
  automaticRetryAllowed: false
  transferAllowed: false
  withdrawalAllowed: false
  executionAllowed: false
  credentialsPersisted: false
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

async function timed<T>(
  name: BitgetV3ReadOnlyCertificationCheck['name'],
  fn: () => Promise<{ reason: string | null; evidence: unknown }>,
): Promise<BitgetV3ReadOnlyCertificationCheck> {
  const started = Date.now()
  try {
    const { reason, evidence } = await fn()
    return {
      name,
      status: 'PASS',
      reason,
      latencyMs: Date.now() - started,
      evidenceHash: await canonicalHash({ name, evidence }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      name,
      status: message.includes('BLOCKED') ? 'BLOCKED' : 'FAIL',
      reason: message,
      latencyMs: Date.now() - started,
      evidenceHash: await canonicalHash({ name, failure: message }),
    }
  }
}

export async function runBitgetV3ReadOnlyCertification(
  input: BitgetV3ReadOnlyCertificationInput,
): Promise<BitgetV3ReadOnlyCertificationResult> {
  const runId = requiredText(input.runId, 'runId')
  const exchangeAccountId = requiredText(input.exchangeAccountId, 'exchangeAccountId')
  const adapter = input.adapter ?? new BitgetV3ReadOnlyAdapter()
  let unifiedAccountSnapshot: BitgetV3UnifiedAccountSnapshot | null = null
  let positionCount = 0
  let productCount = 0
  let positions: readonly BitgetV3PositionSnapshot[] = Object.freeze([])
  let products: readonly ExchangeProduct[] = Object.freeze([])

  const checks = await Promise.all([
    timed('READ_ONLY_PERMISSIONS', async () => {
      const permissions = await input.client.verifyReadOnlyPermissions()
      if (!permissions.readOnly || permissions.accountMode !== 'unified') {
        throw new Error('V3 permissions are not read-only unified')
      }
      return {
        reason: null,
        evidence: { userId: permissions.userId, accountMode: permissions.accountMode },
      }
    }),
    timed('ACCOUNT_ASSETS_CONTRACT', async () => {
      const raw = await input.client.getAccountAssets()
      unifiedAccountSnapshot = adapter.normalizeUnifiedAccount(raw, input.observedAt)
      return {
        reason: null,
        evidence: {
          balanceCount: unifiedAccountSnapshot.balances.length,
          accountEquityUsd: unifiedAccountSnapshot.accountEquityUsd,
        },
      }
    }),
    timed('POSITION_CONTRACT', async () => {
      const raw = await input.client.getCurrentPositions()
      positions = adapter.normalizePositionList(raw)
      positionCount = positions.length
      return {
        reason: null,
        evidence: {
          positionCount,
          productIds: positions.map((position) => position.productId),
        },
      }
    }),
    timed('INSTRUMENTS_CONTRACT', async () => {
      const raw = await input.client.getInstruments('SPOT')
      const root = raw as Record<string, unknown>
      const rows = Array.isArray(root.data) ? (root.data as readonly unknown[]) : []
      products = Object.freeze(
        rows.map((row) =>
          adapter.normalizeProduct(row, input.observedAt, input.productExpiresAt),
        ),
      )
      productCount = products.length
      return {
        reason: null,
        evidence: {
          productCount,
          productIds: products.map((product) => product.productId),
        },
      }
    }),
    timed('READ_ONLY_ENFORCEMENT', async () => {
      let rejected = 0
      try {
        assertBitgetV3ReadOnlyRequest('POST', BITGET_V3_ENDPOINTS.accountAssets)
      } catch {
        rejected += 1
      }
      try {
        assertBitgetV3ReadOnlyRequest('GET', '/api/v3/trade/place-order')
      } catch {
        rejected += 1
      }
      try {
        assertBitgetV3ReadOnlyRequest('DELETE', BITGET_V3_ENDPOINTS.currentPositions)
      } catch {
        rejected += 1
      }
      if (rejected !== 3) throw new Error('read-only enforcement rejected fewer than expected')
      return { reason: null, evidence: { rejected } }
    }),
  ])

  const failed = checks.filter((check) => check.status === 'FAIL')
  const blocked = checks.filter((check) => check.status === 'BLOCKED')
  const status: BitgetV3CertificationStatus =
    failed.length > 0 ? 'FAILED' : blocked.length > 0 ? 'BLOCKED' : 'PASSED'

  return {
    runId,
    provider: 'BITGET',
    apiVersion: 'V3',
    exchangeAccountId,
    status,
    checks: Object.freeze(checks),
    evaluatedAt: input.evaluatedAt,
    evidenceHash: await canonicalHash({
      runId,
      status,
      checks: checks.map((check) => ({
        name: check.name,
        status: check.status,
        evidenceHash: check.evidenceHash,
      })),
    }),
    unifiedAccountSnapshot,
    positionCount,
    productCount,
    certifiedForLive: false,
    providerMutationAllowed: false,
    automaticRetryAllowed: false,
    transferAllowed: false,
    withdrawalAllowed: false,
    executionAllowed: false,
    credentialsPersisted: false,
  }
}
