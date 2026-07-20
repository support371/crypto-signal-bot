import { canonicalHash, canonicalJson } from '../../canonical-json.ts'
import type {
  ExchangeFillSnapshot,
  ExchangeOrderSnapshot,
} from '../../exchange-contracts.ts'
import { normalizeBitgetSymbol } from './endpoints.ts'
import { BitgetReadOnlyAdapter } from './normalizer.ts'
import { BitgetReadOnlyClient } from './read-only-client.ts'
import {
  recoverBitgetUserStreamCursor,
  type BitgetRecoverySnapshot,
  type BitgetUserStreamCursor,
} from './user-stream.ts'

export interface BitgetRestRecoveryOptions {
  symbol: string
  startTimeMs: number
  endTimeMs: number
  limit?: number
}

export interface BitgetRestRecoveryResult {
  snapshot: BitgetRecoverySnapshot
  cursor: BitgetUserStreamCursor
  snapshotHash: string
  windowStartMs: number
  windowEndMs: number
  currentOrderCount: number
  historicalOrderCount: number
  fillCount: number
  readOnly: true
  providerMutationAllowed: false
  executionAllowed: false
}

export class BitgetRecoveryIncompleteError extends Error {
  readonly code = 'BITGET_RECOVERY_INCOMPLETE'

  constructor(message: string) {
    super(message)
    this.name = 'BitgetRecoveryIncompleteError'
  }
}

const MAX_WINDOW_MS = 90 * 24 * 60 * 60 * 1000
const MAX_LIMIT = 100

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function envelopeData(value: unknown, field: string): readonly unknown[] {
  const root = record(value, field)
  const code = String(root.code ?? '').trim()
  if (code && code !== '00000') {
    throw new BitgetRecoveryIncompleteError(`${field} returned Bitget code ${code}`)
  }
  if (!Array.isArray(root.data)) throw new TypeError(`${field}.data must be an array`)
  return root.data
}

function requestTime(value: unknown, fallback: number): number {
  const root = record(value, 'response')
  const candidate = Number(root.requestTime ?? fallback)
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : fallback
}

function validateOptions(options: BitgetRestRecoveryOptions): Required<BitgetRestRecoveryOptions> {
  const symbol = normalizeBitgetSymbol(options.symbol)
  if (!Number.isSafeInteger(options.startTimeMs) || options.startTimeMs < 0) {
    throw new RangeError('startTimeMs must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(options.endTimeMs) || options.endTimeMs <= options.startTimeMs) {
    throw new RangeError('endTimeMs must be greater than startTimeMs')
  }
  if (options.endTimeMs - options.startTimeMs > MAX_WINDOW_MS) {
    throw new RangeError('Bitget recovery window must not exceed 90 days')
  }
  const limit = options.limit ?? MAX_LIMIT
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`limit must be a safe integer from 1 to ${MAX_LIMIT}`)
  }
  return { symbol, startTimeMs: options.startTimeMs, endTimeMs: options.endTimeMs, limit }
}

function orderIdentity(order: ExchangeOrderSnapshot): string {
  const identity = order.exchangeOrderId ?? order.clientOrderId
  if (!identity) throw new BitgetRecoveryIncompleteError('recovery order identifier is missing')
  return identity
}

function deduplicateOrders(
  current: readonly ExchangeOrderSnapshot[],
  historical: readonly ExchangeOrderSnapshot[],
): readonly ExchangeOrderSnapshot[] {
  const byId = new Map<string, ExchangeOrderSnapshot>()
  for (const order of [...current, ...historical]) {
    const identity = orderIdentity(order)
    const existing = byId.get(identity)
    if (!existing) {
      byId.set(identity, order)
      continue
    }
    if (canonicalJson(existing) === canonicalJson(order)) continue
    const existingAt = Date.parse(existing.updatedAt)
    const incomingAt = Date.parse(order.updatedAt)
    if (incomingAt > existingAt) {
      byId.set(identity, order)
      continue
    }
    if (incomingAt === existingAt) {
      throw new BitgetRecoveryIncompleteError(
        `conflicting order snapshot at identical update time: ${identity}`,
      )
    }
  }
  return Object.freeze(Array.from(byId.values()).sort((left, right) => {
    const time = Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
    return time !== 0 ? time : orderIdentity(left).localeCompare(orderIdentity(right))
  }))
}

function deduplicateFills(fills: readonly ExchangeFillSnapshot[]): readonly ExchangeFillSnapshot[] {
  const byId = new Map<string, ExchangeFillSnapshot>()
  for (const fill of fills) {
    const existing = byId.get(fill.fillId)
    if (!existing) {
      byId.set(fill.fillId, fill)
      continue
    }
    if (canonicalJson(existing) !== canonicalJson(fill)) {
      throw new BitgetRecoveryIncompleteError(`conflicting fill snapshot: ${fill.fillId}`)
    }
  }
  return Object.freeze(Array.from(byId.values()).sort((left, right) => {
    const time = Date.parse(left.sequenceTimestamp) - Date.parse(right.sequenceTimestamp)
    return time !== 0 ? time : left.fillId.localeCompare(right.fillId)
  }))
}

function assertPageComplete(name: string, data: readonly unknown[], limit: number): void {
  if (data.length >= limit) {
    throw new BitgetRecoveryIncompleteError(
      `${name} page reached the configured limit; pagination is required before recovery`,
    )
  }
}

export async function buildBitgetRestRecoveryResult(
  cursor: BitgetUserStreamCursor,
  optionsInput: BitgetRestRecoveryOptions,
  responses: {
    currentOrders: unknown
    historyOrders: unknown
    fills: unknown
  },
  recoveredAt: string,
  normalizer = new BitgetReadOnlyAdapter(),
): Promise<BitgetRestRecoveryResult> {
  const options = validateOptions(optionsInput)
  const currentRaw = envelopeData(responses.currentOrders, 'currentOrders')
  const historyRaw = envelopeData(responses.historyOrders, 'historyOrders')
  const fillsRaw = envelopeData(responses.fills, 'fills')
  assertPageComplete('currentOrders', currentRaw, options.limit)
  assertPageComplete('historyOrders', historyRaw, options.limit)
  assertPageComplete('fills', fillsRaw, options.limit)

  const currentOrders = currentRaw.map((item) => normalizer.normalizeOrder(item))
  const historicalOrders = historyRaw.map((item) => normalizer.normalizeOrder(item))
  const fills = fillsRaw.map((item) => normalizer.normalizeFill(item))
  const orders = deduplicateOrders(currentOrders, historicalOrders)
  const deduplicatedFills = deduplicateFills(fills)
  const serverTimestampMs = Math.max(
    requestTime(responses.currentOrders, options.endTimeMs),
    requestTime(responses.historyOrders, options.endTimeMs),
    requestTime(responses.fills, options.endTimeMs),
  )
  const snapshot: BitgetRecoverySnapshot = Object.freeze({
    orders,
    fills: deduplicatedFills,
    snapshotAt: new Date(recoveredAt).toISOString(),
    serverTimestampMs,
  })
  const recoveredCursor = recoverBitgetUserStreamCursor(cursor, snapshot)
  const snapshotHash = await canonicalHash({
    symbol: options.symbol,
    windowStartMs: options.startTimeMs,
    windowEndMs: options.endTimeMs,
    serverTimestampMs,
    orders,
    fills: deduplicatedFills,
    readOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
  })

  return Object.freeze({
    snapshot,
    cursor: recoveredCursor,
    snapshotHash,
    windowStartMs: options.startTimeMs,
    windowEndMs: options.endTimeMs,
    currentOrderCount: currentOrders.length,
    historicalOrderCount: historicalOrders.length,
    fillCount: deduplicatedFills.length,
    readOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
  })
}

export class BitgetReadOnlyRecoveryClient {
  private readonly client: BitgetReadOnlyClient
  private readonly normalizer: BitgetReadOnlyAdapter

  constructor(client: BitgetReadOnlyClient, normalizer = new BitgetReadOnlyAdapter()) {
    this.client = client
    this.normalizer = normalizer
  }

  async recover(
    cursor: BitgetUserStreamCursor,
    optionsInput: BitgetRestRecoveryOptions,
    recoveredAt: string,
  ): Promise<BitgetRestRecoveryResult> {
    const options = validateOptions(optionsInput)
    const query = {
      symbol: options.symbol,
      startTime: options.startTimeMs,
      endTime: options.endTimeMs,
      limit: options.limit,
    }
    const [currentOrders, historyOrders, fills] = await Promise.all([
      this.client.listCurrentOrders(query),
      this.client.listHistoryOrders(query),
      this.client.listFills(query),
    ])
    return buildBitgetRestRecoveryResult(
      cursor,
      options,
      { currentOrders, historyOrders, fills },
      recoveredAt,
      this.normalizer,
    )
  }
}
