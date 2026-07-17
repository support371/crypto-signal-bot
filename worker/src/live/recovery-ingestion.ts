import { canonicalHash, canonicalJson } from './canonical-json.ts'
import type { BitgetRestRecoveryResult } from './adapters/bitget/recovery.ts'
import type {
  ExchangeFillSnapshot,
  ExchangeOrderSnapshot,
} from './exchange-contracts.ts'

export interface RecoveryOrderObservation {
  observationId: string
  orderIdentity: string
  orderHash: string
  orderJson: string
  observedAt: string
}

export interface RecoveryFillObservation {
  observationId: string
  fillId: string
  fillHash: string
  fillJson: string
  sequenceTimestamp: string
}

export interface RecoveryAccountingTaskIntent {
  taskIntentId: string
  fillId: string
  fillHash: string
  sequenceTimestamp: string
  status: 'PENDING_ACCOUNTING'
  accountingApplied: false
  reservationSettled: false
  providerMutationAllowed: false
  executionAllowed: false
}

export interface BitgetRecoveryIngestionInput {
  ingestionId: string
  exchangeAccountId: string
  productId: string
  recoveredAt: string
  recovery: BitgetRestRecoveryResult
}

export interface BitgetRecoveryIngestionPlan {
  ingestionId: string
  provider: 'BITGET'
  exchangeAccountId: string
  productId: string
  snapshotId: string
  snapshotHash: string
  requestHash: string
  windowStartMs: number
  windowEndMs: number
  serverTimestampMs: number
  recoveredAt: string
  orderObservations: readonly RecoveryOrderObservation[]
  fillObservations: readonly RecoveryFillObservation[]
  accountingTaskIntents: readonly RecoveryAccountingTaskIntent[]
  complete: true
  bounded: true
  readOnly: true
  accountingApplied: false
  reservationSettled: false
  providerMutationAllowed: false
  executionAllowed: false
  ingestionHash: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function timestamp(value: string, field: string): string {
  const normalized = required(value, field)
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function orderIdentity(order: ExchangeOrderSnapshot): string {
  const identity = order.exchangeOrderId ?? order.clientOrderId
  if (!identity) throw new TypeError('recovered order identifier is missing')
  return identity
}

function validateRecoveryLocks(recovery: BitgetRestRecoveryResult): void {
  if (
    recovery.readOnly !== true
    || recovery.providerMutationAllowed !== false
    || recovery.executionAllowed !== false
  ) {
    throw new TypeError('Bitget recovery result violates read-only capability locks')
  }
  if (!recovery.cursor.initialized || recovery.cursor.recoveryRequired) {
    throw new TypeError('Bitget recovery cursor is not fully recovered')
  }
  if (recovery.snapshotHash.trim().length !== 64 || !/^[a-f0-9]{64}$/.test(recovery.snapshotHash)) {
    throw new TypeError('Bitget recovery snapshotHash must be lowercase SHA-256')
  }
  if (
    !Number.isSafeInteger(recovery.windowStartMs)
    || !Number.isSafeInteger(recovery.windowEndMs)
    || recovery.windowEndMs <= recovery.windowStartMs
  ) {
    throw new TypeError('Bitget recovery window is invalid')
  }
  if (!Number.isSafeInteger(recovery.snapshot.serverTimestampMs) || recovery.snapshot.serverTimestampMs < 0) {
    throw new TypeError('Bitget recovery server timestamp is invalid')
  }
}

async function orderObservation(
  snapshotId: string,
  order: ExchangeOrderSnapshot,
): Promise<RecoveryOrderObservation> {
  const identity = orderIdentity(order)
  const orderJson = canonicalJson(order)
  const orderHash = await canonicalHash(order)
  return Object.freeze({
    observationId: `${snapshotId}:order:${identity}:${order.updatedAt}`,
    orderIdentity: identity,
    orderHash,
    orderJson,
    observedAt: timestamp(order.updatedAt, 'order.updatedAt'),
  })
}

async function fillObservation(
  snapshotId: string,
  fill: ExchangeFillSnapshot,
): Promise<RecoveryFillObservation> {
  const fillId = required(fill.fillId, 'fill.fillId')
  const fillJson = canonicalJson(fill)
  const fillHash = await canonicalHash(fill)
  return Object.freeze({
    observationId: `${snapshotId}:fill:${fillId}`,
    fillId,
    fillHash,
    fillJson,
    sequenceTimestamp: timestamp(fill.sequenceTimestamp, 'fill.sequenceTimestamp'),
  })
}

export async function buildBitgetRecoveryIngestionPlan(
  input: BitgetRecoveryIngestionInput,
): Promise<BitgetRecoveryIngestionPlan> {
  const ingestionId = required(input.ingestionId, 'ingestionId')
  const exchangeAccountId = required(input.exchangeAccountId, 'exchangeAccountId')
  const productId = required(input.productId, 'productId').toUpperCase()
  const recoveredAt = timestamp(input.recoveredAt, 'recoveredAt')
  validateRecoveryLocks(input.recovery)

  for (const order of input.recovery.snapshot.orders) {
    if (order.productId !== productId) {
      throw new TypeError(`recovered order product mismatch: ${order.productId}`)
    }
  }
  for (const fill of input.recovery.snapshot.fills) {
    if (fill.productId !== productId) {
      throw new TypeError(`recovered fill product mismatch: ${fill.productId}`)
    }
  }

  const snapshotId = `bitget-recovery:${input.recovery.snapshotHash.slice(0, 32)}`
  const orderObservations = Object.freeze(await Promise.all(
    input.recovery.snapshot.orders.map((order) => orderObservation(snapshotId, order)),
  ))
  const fillObservations = Object.freeze(await Promise.all(
    input.recovery.snapshot.fills.map((fill) => fillObservation(snapshotId, fill)),
  ))
  const accountingTaskIntents = Object.freeze(fillObservations.map((fill) => Object.freeze({
    taskIntentId: `recovery-accounting:${fill.fillHash.slice(0, 32)}`,
    fillId: fill.fillId,
    fillHash: fill.fillHash,
    sequenceTimestamp: fill.sequenceTimestamp,
    status: 'PENDING_ACCOUNTING' as const,
    accountingApplied: false as const,
    reservationSettled: false as const,
    providerMutationAllowed: false as const,
    executionAllowed: false as const,
  })))

  const requestHash = await canonicalHash({
    ingestionId,
    provider: 'BITGET',
    exchangeAccountId,
    productId,
    snapshotId,
    snapshotHash: input.recovery.snapshotHash,
    windowStartMs: input.recovery.windowStartMs,
    windowEndMs: input.recovery.windowEndMs,
    serverTimestampMs: input.recovery.snapshot.serverTimestampMs,
    recoveredAt,
  })
  const evidence = {
    ingestionId,
    provider: 'BITGET',
    exchangeAccountId,
    productId,
    snapshotId,
    snapshotHash: input.recovery.snapshotHash,
    requestHash,
    windowStartMs: input.recovery.windowStartMs,
    windowEndMs: input.recovery.windowEndMs,
    serverTimestampMs: input.recovery.snapshot.serverTimestampMs,
    recoveredAt,
    orderObservations,
    fillObservations,
    accountingTaskIntents,
    complete: true,
    bounded: true,
    readOnly: true,
    accountingApplied: false,
    reservationSettled: false,
    providerMutationAllowed: false,
    executionAllowed: false,
  }
  const ingestionHash = await canonicalHash(evidence)

  return Object.freeze({ ...evidence, ingestionHash })
}
