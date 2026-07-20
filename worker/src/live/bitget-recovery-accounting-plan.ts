import { canonicalHash } from './canonical-json.ts'
import { asDecimalString, type DecimalString } from './decimal.ts'
import type { FillAccountingAccounts } from './fill-accounting.ts'
import type { VerifiedSpotFillAccountingInput } from './fill-accounting-service.ts'
import type { BitgetRestRecoveryResult } from './adapters/bitget/recovery.ts'

export interface RecoveryOrderBinding {
  exchangeOrderId: string
  internalOrderId: string
  correlationId: string
}

export interface RecoveryFeeQuoteValuation {
  fillId: string
  feeQuoteValue: DecimalString
}

export interface BitgetRecoveryAccountingPlanInput {
  recovery: BitgetRestRecoveryResult
  exchangeAccountId: string
  productId: string
  baseAsset: string
  quoteAsset: string
  orderBindings: readonly RecoveryOrderBinding[]
  feeQuoteValuations: readonly RecoveryFeeQuoteValuation[]
  accounts: FillAccountingAccounts
}

export interface BitgetRecoveryAccountingPlan {
  exchangeName: 'BITGET'
  exchangeAccountId: string
  productId: string
  recoverySnapshotHash: string
  commandCount: number
  commands: readonly VerifiedSpotFillAccountingInput[]
  planHash: string
  accountingEvidenceReady: true
  automaticallyDispatched: false
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export class RecoveryAccountingPlanIncompleteError extends Error {
  readonly code = 'RECOVERY_ACCOUNTING_PLAN_INCOMPLETE'

  constructor(message: string) {
    super(message)
    this.name = 'RecoveryAccountingPlanIncompleteError'
  }
}

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

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function orderBindingMap(
  bindings: readonly RecoveryOrderBinding[],
): ReadonlyMap<string, RecoveryOrderBinding> {
  const result = new Map<string, RecoveryOrderBinding>()
  for (const binding of bindings) {
    const exchangeOrderId = required(binding.exchangeOrderId, 'exchangeOrderId')
    if (result.has(exchangeOrderId)) {
      throw new RecoveryAccountingPlanIncompleteError(
        `duplicate recovery order binding: ${exchangeOrderId}`,
      )
    }
    result.set(exchangeOrderId, Object.freeze({
      exchangeOrderId,
      internalOrderId: required(binding.internalOrderId, 'internalOrderId'),
      correlationId: required(binding.correlationId, 'correlationId'),
    }))
  }
  return result
}

function feeValuationMap(
  valuations: readonly RecoveryFeeQuoteValuation[],
): ReadonlyMap<string, DecimalString> {
  const result = new Map<string, DecimalString>()
  for (const valuation of valuations) {
    const fillId = required(valuation.fillId, 'fee valuation fillId')
    if (result.has(fillId)) {
      throw new RecoveryAccountingPlanIncompleteError(
        `duplicate recovery fee valuation: ${fillId}`,
      )
    }
    result.set(
      fillId,
      asDecimalString(valuation.feeQuoteValue, `feeQuoteValue:${fillId}`),
    )
  }
  return result
}

function assertRecoveryReady(recovery: BitgetRestRecoveryResult): void {
  if (
    recovery.readOnly !== true
    || recovery.providerMutationAllowed !== false
    || recovery.executionAllowed !== false
  ) {
    throw new RecoveryAccountingPlanIncompleteError(
      'Bitget recovery result violates the read-only capability boundary',
    )
  }
  if (!recovery.cursor.initialized || recovery.cursor.recoveryRequired) {
    throw new RecoveryAccountingPlanIncompleteError(
      'Bitget recovery cursor is not complete',
    )
  }
  if (recovery.fillCount !== recovery.snapshot.fills.length) {
    throw new RecoveryAccountingPlanIncompleteError(
      'Bitget recovery fill count does not match the snapshot',
    )
  }
  sha256(recovery.snapshotHash, 'recovery.snapshotHash')
}

function feeQuoteValue(
  fill: BitgetRestRecoveryResult['snapshot']['fills'][number],
  baseAsset: string,
  quoteAsset: string,
  valuations: ReadonlyMap<string, DecimalString>,
): DecimalString | null {
  const commissionAsset = fill.commissionAsset?.trim().toUpperCase() || null
  const valuation = valuations.get(fill.fillId) ?? null

  if (commissionAsset === null || fill.commission === '0') {
    if (valuation !== null && valuation !== '0') {
      throw new RecoveryAccountingPlanIncompleteError(
        `fill ${fill.fillId} has fee valuation without a positive commission`,
      )
    }
    return null
  }
  if (commissionAsset === baseAsset) {
    if (valuation !== null && valuation !== '0') {
      throw new RecoveryAccountingPlanIncompleteError(
        `base-asset fee valuation must be null or zero for fill ${fill.fillId}`,
      )
    }
    return null
  }
  if (commissionAsset === quoteAsset) {
    if (valuation !== null && valuation !== fill.commission) {
      throw new RecoveryAccountingPlanIncompleteError(
        `quote-asset fee valuation must equal commission for fill ${fill.fillId}`,
      )
    }
    return valuation
  }
  if (valuation === null || valuation === '0') {
    throw new RecoveryAccountingPlanIncompleteError(
      `third-asset fee quote valuation is required for fill ${fill.fillId}`,
    )
  }
  return valuation
}

export async function buildBitgetRecoveryAccountingPlan(
  input: BitgetRecoveryAccountingPlanInput,
): Promise<BitgetRecoveryAccountingPlan> {
  assertRecoveryReady(input.recovery)
  const exchangeAccountId = required(input.exchangeAccountId, 'exchangeAccountId')
  const productId = required(input.productId, 'productId').toUpperCase()
  const baseAsset = asset(input.baseAsset, 'baseAsset')
  const quoteAsset = asset(input.quoteAsset, 'quoteAsset')
  if (baseAsset === quoteAsset) throw new TypeError('baseAsset and quoteAsset must differ')

  const bindings = orderBindingMap(input.orderBindings)
  const valuations = feeValuationMap(input.feeQuoteValuations)
  const snapshotFillIds = new Set(input.recovery.snapshot.fills.map((fill) => fill.fillId))
  for (const fillId of valuations.keys()) {
    if (!snapshotFillIds.has(fillId)) {
      throw new RecoveryAccountingPlanIncompleteError(
        `fee valuation does not belong to the recovery snapshot: ${fillId}`,
      )
    }
  }

  const commands: VerifiedSpotFillAccountingInput[] = []
  for (const fill of [...input.recovery.snapshot.fills].sort((left, right) => {
    const time = Date.parse(left.sequenceTimestamp) - Date.parse(right.sequenceTimestamp)
    return time !== 0 ? time : left.fillId.localeCompare(right.fillId)
  })) {
    if (fill.productId !== productId) {
      throw new RecoveryAccountingPlanIncompleteError(
        `recovered fill product mismatch: ${fill.fillId}`,
      )
    }
    const binding = bindings.get(fill.exchangeOrderId)
    if (!binding) {
      throw new RecoveryAccountingPlanIncompleteError(
        `internal order binding is missing for recovered fill ${fill.fillId}`,
      )
    }
    const rawResponseHash = await canonicalHash({
      source: 'BITGET_REST_RECOVERY',
      recoverySnapshotHash: input.recovery.snapshotHash,
      fill,
    })
    commands.push(Object.freeze({
      exchangeName: 'BITGET',
      exchangeAccountId,
      internalOrderId: binding.internalOrderId,
      correlationId: binding.correlationId,
      baseAsset,
      quoteAsset,
      fill,
      feeQuoteValue: feeQuoteValue(fill, baseAsset, quoteAsset, valuations),
      accounts: input.accounts,
      rawResponseHash,
    }))
  }

  const planHash = await canonicalHash({
    exchangeName: 'BITGET',
    exchangeAccountId,
    productId,
    recoverySnapshotHash: input.recovery.snapshotHash,
    commands,
    accountingEvidenceReady: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })

  return Object.freeze({
    exchangeName: 'BITGET',
    exchangeAccountId,
    productId,
    recoverySnapshotHash: input.recovery.snapshotHash,
    commandCount: commands.length,
    commands: Object.freeze(commands),
    planHash,
    accountingEvidenceReady: true,
    automaticallyDispatched: false,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}
