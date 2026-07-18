import { canonicalHash } from './canonical-json.ts'
import type {
  ExchangeAccountBalance,
  ExchangeFillSnapshot,
  ExchangeOrderSnapshot,
  ExchangeProduct,
} from './exchange-contracts.ts'
import {
  BITGET_SPOT_ENDPOINTS,
  normalizeBitgetSymbol,
  type BitgetReadOnlyEndpoint,
} from './adapters/bitget/endpoints.ts'
import {
  BitgetReadOnlyAdapter,
} from './adapters/bitget/normalizer.ts'
import type {
  BitgetAccountPermissions,
} from './adapters/bitget/read-only-client.ts'

export type BitgetReadOnlyCertificationCheckStatus = 'PASS' | 'FAIL' | 'BLOCKED'
export type BitgetReadOnlyCertificationStatus = 'PASSED' | 'FAILED' | 'BLOCKED'

export interface BitgetReadOnlyCertificationClient {
  verifyReadOnlyPermissions(): Promise<BitgetAccountPermissions>
  request(
    endpoint: BitgetReadOnlyEndpoint,
    query?: Readonly<Record<string, string | number | boolean | null | undefined>>,
  ): Promise<unknown>
  listAccountAssets(coin?: string): Promise<unknown>
  listCurrentOrders(
    query?: Readonly<Record<string, string | number | null | undefined>>,
  ): Promise<unknown>
  listHistoryOrders(
    query?: Readonly<Record<string, string | number | null | undefined>>,
  ): Promise<unknown>
  listFills(
    query?: Readonly<Record<string, string | number | null | undefined>>,
  ): Promise<unknown>
}

export interface BitgetReadOnlyCertificationInput {
  runId: string
  exchangeAccountId: string
  productId: string
  baseAsset: string
  quoteAsset: string
  windowStartMs: number
  windowEndMs: number
  observedAt: string
  productExpiresAt: string
  evaluatedAt: string
  client: BitgetReadOnlyCertificationClient
  adapter?: BitgetReadOnlyAdapter
}

export interface BitgetReadOnlyCertificationCheck {
  name:
    | 'READ_ONLY_PERMISSIONS'
    | 'PRODUCT_CONTRACT'
    | 'BALANCE_CONTRACT'
    | 'CURRENT_ORDER_CONTRACT'
    | 'ORDER_HISTORY_CONTRACT'
    | 'FILL_CONTRACT'
    | 'PAGINATION_BOUNDARY'
    | 'RECOVERY_IDENTITY_CONSISTENCY'
  status: BitgetReadOnlyCertificationCheckStatus
  reason: string | null
  evidenceHash: string
}

export interface BitgetReadOnlyCertificationResult {
  runId: string
  provider: 'BITGET'
  exchangeAccountId: string
  productId: string
  status: BitgetReadOnlyCertificationStatus
  readOnlyEvidenceComplete: boolean
  permissionsVerified: boolean
  productCount: number
  balanceCount: number
  currentOrderCount: number
  historyOrderCount: number
  fillCount: number
  duplicateOrderCount: number
  duplicateFillCount: number
  checks: readonly BitgetReadOnlyCertificationCheck[]
  evaluatedAt: string
  evidenceHash: string
  certifiedForLive: false
  providerMutationAllowed: false
  automaticRetryAllowed: false
  transferAllowed: false
  withdrawalAllowed: false
  executionAllowed: false
  credentialsPersisted: false
}

const PRIVATE_LIMIT = 100
const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
const SHA256_PATTERN = /^[a-f0-9]{64}$/

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function asset(value: string, field: string): string {
  const normalized = required(value, field).toUpperCase()
  if (!/^[A-Z0-9]{2,20}$/.test(normalized)) {
    throw new TypeError(`${field} must be an uppercase asset code`)
  }
  return normalized
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return parsed
}

function queryWindow(start: number, end: number): void {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= end) {
    throw new TypeError('certification query window must use increasing safe Unix milliseconds')
  }
  if (end - start > MAX_WINDOW_MS) {
    throw new TypeError('certification query window must not exceed 90 days')
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function responseRows(
  value: unknown,
  field: string,
  collectionKeys: readonly string[],
  allowSingleObject = false,
): readonly unknown[] {
  const root = record(value, field)
  const data = 'data' in root ? root.data : root
  if (Array.isArray(data)) return Object.freeze([...data])
  if (data && typeof data === 'object') {
    const dataRecord = data as Record<string, unknown>
    for (const key of collectionKeys) {
      if (Array.isArray(dataRecord[key])) return Object.freeze([...(dataRecord[key] as unknown[])])
    }
    if (allowSingleObject) return Object.freeze([dataRecord])
  }
  throw new TypeError(`${field} does not contain a supported row collection`)
}

function productSort(left: ExchangeProduct, right: ExchangeProduct): number {
  return left.productId.localeCompare(right.productId)
}

function balanceSort(left: ExchangeAccountBalance, right: ExchangeAccountBalance): number {
  return left.asset.localeCompare(right.asset)
}

function orderIdentity(order: ExchangeOrderSnapshot): string {
  return order.exchangeOrderId ?? `client:${order.clientOrderId ?? 'missing'}`
}

function orderSort(left: ExchangeOrderSnapshot, right: ExchangeOrderSnapshot): number {
  const time = left.updatedAt.localeCompare(right.updatedAt)
  return time !== 0 ? time : orderIdentity(left).localeCompare(orderIdentity(right))
}

function fillSort(left: ExchangeFillSnapshot, right: ExchangeFillSnapshot): number {
  const time = left.sequenceTimestamp.localeCompare(right.sequenceTimestamp)
  return time !== 0 ? time : left.fillId.localeCompare(right.fillId)
}

async function check(
  name: BitgetReadOnlyCertificationCheck['name'],
  status: BitgetReadOnlyCertificationCheckStatus,
  reason: string | null,
  evidence: unknown,
): Promise<BitgetReadOnlyCertificationCheck> {
  return Object.freeze({
    name,
    status,
    reason,
    evidenceHash: await canonicalHash({ name, status, reason, evidence }),
  })
}

async function identityCounts<T>(
  rows: readonly T[],
  identity: (row: T) => string,
): Promise<{ duplicateCount: number; conflictingIdentities: readonly string[] }> {
  const seen = new Map<string, string>()
  let duplicateCount = 0
  const conflicts = new Set<string>()
  for (const row of rows) {
    const id = required(identity(row), 'normalized identity')
    const hash = await canonicalHash(row)
    const previous = seen.get(id)
    if (previous === undefined) seen.set(id, hash)
    else if (previous === hash) duplicateCount += 1
    else conflicts.add(id)
  }
  return {
    duplicateCount,
    conflictingIdentities: Object.freeze([...conflicts].sort()),
  }
}

function statusFromChecks(
  checks: readonly BitgetReadOnlyCertificationCheck[],
): BitgetReadOnlyCertificationStatus {
  if (checks.some((item) => item.status === 'FAIL')) return 'FAILED'
  if (checks.some((item) => item.status === 'BLOCKED')) return 'BLOCKED'
  return 'PASSED'
}

export async function certifyBitgetReadOnlyContracts(
  input: BitgetReadOnlyCertificationInput,
): Promise<BitgetReadOnlyCertificationResult> {
  const runId = required(input.runId, 'runId')
  const exchangeAccountId = required(input.exchangeAccountId, 'exchangeAccountId')
  const productId = required(input.productId, 'productId').toUpperCase()
  const baseAsset = asset(input.baseAsset, 'baseAsset')
  const quoteAsset = asset(input.quoteAsset, 'quoteAsset')
  if (baseAsset === quoteAsset) throw new TypeError('baseAsset and quoteAsset must differ')
  if (normalizeBitgetSymbol(productId) !== normalizeBitgetSymbol(`${baseAsset}${quoteAsset}`)) {
    throw new TypeError('productId does not match baseAsset and quoteAsset')
  }
  queryWindow(input.windowStartMs, input.windowEndMs)
  const evaluatedAtMs = timestamp(input.evaluatedAt, 'evaluatedAt')
  const observedAtMs = timestamp(input.observedAt, 'observedAt')
  const productExpiresAtMs = timestamp(input.productExpiresAt, 'productExpiresAt')
  if (observedAtMs > evaluatedAtMs || productExpiresAtMs <= evaluatedAtMs) {
    throw new TypeError('product evidence must be observed and fresh at evaluation time')
  }

  const adapter = input.adapter ?? new BitgetReadOnlyAdapter()
  const checks: BitgetReadOnlyCertificationCheck[] = []

  const permissions = await input.client.verifyReadOnlyPermissions()
  const permissionsVerified = permissions.readOnly === true
  checks.push(await check(
    'READ_ONLY_PERMISSIONS',
    permissionsVerified ? 'PASS' : 'FAIL',
    permissionsVerified ? null : 'provider_key_is_not_read_only',
    {
      userIdHash: await canonicalHash(permissions.userId),
      authorityCount: permissions.authorities.length,
      authoritiesHash: await canonicalHash([...permissions.authorities].sort()),
      readOnly: permissions.readOnly,
    },
  ))

  let products: readonly ExchangeProduct[] = []
  try {
    const rawProducts = responseRows(
      await input.client.request(BITGET_SPOT_ENDPOINTS.symbols, {
        symbol: normalizeBitgetSymbol(productId),
      }),
      'Bitget products response',
      ['symbolList', 'symbols', 'list'],
      true,
    )
    products = Object.freeze(rawProducts
      .map((row) => adapter.normalizeProduct(row, input.observedAt, input.productExpiresAt))
      .sort(productSort))
    const target = products.find((product) => product.productId === productId)
    const accepted = target !== undefined && target.rules.productId === productId
    checks.push(await check(
      'PRODUCT_CONTRACT',
      accepted ? 'PASS' : 'FAIL',
      accepted ? null : 'target_product_contract_missing',
      {
        productCount: products.length,
        productsHash: await canonicalHash(products),
        targetProductHash: target ? await canonicalHash(target) : null,
      },
    ))
  } catch (error) {
    checks.push(await check('PRODUCT_CONTRACT', 'FAIL', 'product_contract_normalization_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
  }

  let balances: readonly ExchangeAccountBalance[] = []
  try {
    const rawBalances = responseRows(
      await input.client.listAccountAssets(),
      'Bitget account-assets response',
      ['assets', 'coinList', 'list'],
    )
    balances = Object.freeze(rawBalances
      .map((row) => adapter.normalizeAccount(row, input.observedAt))
      .sort(balanceSort))
    const assets = new Set(balances.map((balance) => balance.asset))
    const accepted = assets.has(baseAsset) && assets.has(quoteAsset)
    checks.push(await check(
      'BALANCE_CONTRACT',
      accepted ? 'PASS' : 'FAIL',
      accepted ? null : 'required_asset_balance_missing',
      {
        balanceCount: balances.length,
        assetCodes: [...assets].sort(),
        balancesHash: await canonicalHash(balances),
      },
    ))
  } catch (error) {
    checks.push(await check('BALANCE_CONTRACT', 'FAIL', 'balance_contract_normalization_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
  }

  const query = Object.freeze({
    symbol: normalizeBitgetSymbol(productId),
    startTime: input.windowStartMs,
    endTime: input.windowEndMs,
    limit: PRIVATE_LIMIT,
  })

  let currentOrders: readonly ExchangeOrderSnapshot[] = []
  try {
    const rows = responseRows(
      await input.client.listCurrentOrders({ symbol: query.symbol, limit: query.limit }),
      'Bitget current-orders response',
      ['orderList', 'orders', 'list'],
    )
    currentOrders = Object.freeze(rows.map((row) => adapter.normalizeOrder(row)).sort(orderSort))
    const accepted = currentOrders.every((order) => order.productId === productId)
    checks.push(await check(
      'CURRENT_ORDER_CONTRACT',
      accepted ? 'PASS' : 'FAIL',
      accepted ? null : 'current_order_product_mismatch',
      { count: currentOrders.length, hash: await canonicalHash(currentOrders) },
    ))
  } catch (error) {
    checks.push(await check('CURRENT_ORDER_CONTRACT', 'FAIL', 'current_order_contract_normalization_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
  }

  let historyOrders: readonly ExchangeOrderSnapshot[] = []
  try {
    const rows = responseRows(
      await input.client.listHistoryOrders(query),
      'Bitget order-history response',
      ['orderList', 'orders', 'list'],
    )
    historyOrders = Object.freeze(rows.map((row) => adapter.normalizeOrder(row)).sort(orderSort))
    const accepted = historyOrders.every((order) => order.productId === productId)
    checks.push(await check(
      'ORDER_HISTORY_CONTRACT',
      accepted ? 'PASS' : 'FAIL',
      accepted ? null : 'history_order_product_mismatch',
      { count: historyOrders.length, hash: await canonicalHash(historyOrders) },
    ))
  } catch (error) {
    checks.push(await check('ORDER_HISTORY_CONTRACT', 'FAIL', 'history_order_contract_normalization_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
  }

  let fills: readonly ExchangeFillSnapshot[] = []
  try {
    const rows = responseRows(
      await input.client.listFills(query),
      'Bitget fills response',
      ['fillList', 'fills', 'list'],
    )
    fills = Object.freeze(rows.map((row) => adapter.normalizeFill(row)).sort(fillSort))
    const accepted = fills.every((fill) => fill.productId === productId)
    checks.push(await check(
      'FILL_CONTRACT',
      accepted ? 'PASS' : 'FAIL',
      accepted ? null : 'fill_product_mismatch',
      { count: fills.length, hash: await canonicalHash(fills) },
    ))
  } catch (error) {
    checks.push(await check('FILL_CONTRACT', 'FAIL', 'fill_contract_normalization_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }))
  }

  const saturatedCollections = [
    currentOrders.length === PRIVATE_LIMIT ? 'current_orders' : null,
    historyOrders.length === PRIVATE_LIMIT ? 'history_orders' : null,
    fills.length === PRIVATE_LIMIT ? 'fills' : null,
  ].filter((value): value is string => value !== null)
  checks.push(await check(
    'PAGINATION_BOUNDARY',
    saturatedCollections.length === 0 ? 'PASS' : 'BLOCKED',
    saturatedCollections.length === 0 ? null : 'saturated_page_requires_continuation_evidence',
    {
      limit: PRIVATE_LIMIT,
      saturatedCollections,
      queryWindowMs: input.windowEndMs - input.windowStartMs,
    },
  ))

  const orderIdentities = await identityCounts(
    [...currentOrders, ...historyOrders],
    orderIdentity,
  )
  const fillIdentities = await identityCounts(fills, (fill) => fill.fillId)
  const conflicts = Object.freeze([
    ...orderIdentities.conflictingIdentities.map((id) => `order:${id}`),
    ...fillIdentities.conflictingIdentities.map((id) => `fill:${id}`),
  ].sort())
  checks.push(await check(
    'RECOVERY_IDENTITY_CONSISTENCY',
    conflicts.length === 0 ? 'PASS' : 'FAIL',
    conflicts.length === 0 ? null : 'conflicting_provider_identity_evidence',
    {
      conflicts,
      duplicateOrderCount: orderIdentities.duplicateCount,
      duplicateFillCount: fillIdentities.duplicateCount,
    },
  ))

  const status = statusFromChecks(checks)
  const evidence = {
    runId,
    provider: 'BITGET' as const,
    exchangeAccountId,
    productId,
    status,
    permissionsVerified,
    productCount: products.length,
    balanceCount: balances.length,
    currentOrderCount: currentOrders.length,
    historyOrderCount: historyOrders.length,
    fillCount: fills.length,
    duplicateOrderCount: orderIdentities.duplicateCount,
    duplicateFillCount: fillIdentities.duplicateCount,
    checks,
    evaluatedAt: new Date(evaluatedAtMs).toISOString(),
    certifiedForLive: false as const,
    providerMutationAllowed: false as const,
    automaticRetryAllowed: false as const,
    transferAllowed: false as const,
    withdrawalAllowed: false as const,
    executionAllowed: false as const,
    credentialsPersisted: false as const,
  }
  const evidenceHash = await canonicalHash(evidence)
  if (!SHA256_PATTERN.test(evidenceHash)) throw new TypeError('certification evidence hash is invalid')

  return Object.freeze({
    ...evidence,
    readOnlyEvidenceComplete: status === 'PASSED',
    checks: Object.freeze(checks),
    evidenceHash,
  })
}
