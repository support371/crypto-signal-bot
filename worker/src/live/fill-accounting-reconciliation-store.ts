import { canonicalHash, canonicalJson } from './canonical-json.ts'
import {
  calculateSignedLedgerBalance,
  reconcileFillAccounting,
  type AccountingReconciliationLot,
  type AccountingReconciliationPosition,
  type FillAccountingReconciliationResult,
} from './fill-accounting-reconciliation.ts'
import {
  addDecimal,
  asDecimalString,
  asSignedDecimalString,
  compareDecimal,
  subtractNonNegativeDecimal,
  type DecimalString,
  type SignedDecimalString,
} from './decimal.ts'
import {
  normalizeExecutionExchange,
  type CanonicalExecutionExchange,
} from './exchange-registry.ts'

export interface FillAccountingReconciliationStoreEnv {
  DB: D1Database
}

export interface PersistFillAccountingReconciliationInput {
  reconciliationId: string
  exchangeName: CanonicalExecutionExchange | string
  exchangeAccountId: string
  productId: string
  baseAsset: string
  quoteAsset: string
  ledgerBaseAccountIds: readonly string[]
  exchangeBaseBalance: DecimalString | null
  currentPrice: DecimalString | null
  exchangeObservationHash: string | null
  observedAt: string
}

export interface PersistFillAccountingReconciliationResult
  extends FillAccountingReconciliationResult {
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  exchangeName: CanonicalExecutionExchange
}

export class FillAccountingReconciliationConflictError extends Error {
  readonly code = 'FILL_ACCOUNTING_RECONCILIATION_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'FillAccountingReconciliationConflictError'
  }
}

export class FillAccountingReconciliationUnavailableError extends Error {
  readonly code = 'FILL_ACCOUNTING_RECONCILIATION_UNAVAILABLE'

  constructor(message: string) {
    super(message)
    this.name = 'FillAccountingReconciliationUnavailableError'
  }
}

type ReconciliationReceiptRow = {
  input_hash: string
  reconciliation_hash: string
  status: 'CLEAR' | 'HALT_FOR_REVIEW'
  reasons_json: string
  reconstructed_quantity: string
  reconstructed_cost_basis_quote: string
  reconstructed_average_entry_price: string | null
  reconstructed_realized_pnl_quote: string
  ledger_base_inventory_balance: string
  exchange_base_balance: string | null
  current_price: string | null
  market_value_quote: string | null
  unrealized_pnl_quote: string | null
  provider_mutation_allowed: number
  reservation_applied: number
  execution_allowed: number
}

type PositionRow = {
  quantity: string
  total_cost_basis_quote: string
  average_entry_price: string | null
  cumulative_realized_pnl_quote: string
  status: 'OPEN' | 'CLOSED'
}

type LotRow = {
  lot_id: string
  original_quantity: string
  original_cost_quote: string
}

type ConsumptionRow = {
  lot_id: string
  quantity: string
  cost_basis_quote: string
}

type RealizedPnlRow = {
  realized_pnl_quote: string
}

type LedgerEntryRow = {
  direction: 'DEBIT' | 'CREDIT'
  amount: string
}

const ZERO = asDecimalString('0')
const MAX_LEDGER_ACCOUNTS = 20

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

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function optionalHash(value: string | null, field: string): string | null {
  if (value === null) return null
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function optionalDecimal(value: DecimalString | null, field: string): DecimalString | null {
  return value === null ? null : asDecimalString(value, field)
}

function ledgerAccountIds(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_LEDGER_ACCOUNTS) {
    throw new RangeError(`ledgerBaseAccountIds must contain 1-${MAX_LEDGER_ACCOUNTS} accounts`)
  }
  const normalized = Array.from(new Set(values.map((value) => required(value, 'ledgerBaseAccountId'))))
  if (normalized.length !== values.length) throw new TypeError('ledgerBaseAccountIds must be unique')
  return Object.freeze(normalized.sort())
}

function parseReasons(value: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new FillAccountingReconciliationConflictError(
      'stored reconciliation reasons are not valid JSON',
    )
  }
  if (!Array.isArray(parsed) || parsed.some((reason) => typeof reason !== 'string')) {
    throw new FillAccountingReconciliationConflictError(
      'stored reconciliation reasons must be a string array',
    )
  }
  return Object.freeze(Array.from(new Set(parsed)).sort())
}

function assertReceiptLocks(row: ReconciliationReceiptRow): void {
  if (
    row.provider_mutation_allowed !== 0
    || row.reservation_applied !== 0
    || row.execution_allowed !== 0
  ) {
    throw new FillAccountingReconciliationConflictError(
      'stored reconciliation violates permanent capability locks',
    )
  }
}

function stableInput(
  input: PersistFillAccountingReconciliationInput,
  exchangeName: CanonicalExecutionExchange,
  normalizedLedgerAccountIds: readonly string[],
  exchangeObservationHash: string | null,
  observedAt: string,
): unknown {
  return {
    reconciliationId: input.reconciliationId,
    exchangeName,
    exchangeAccountId: input.exchangeAccountId,
    productId: input.productId,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
    ledgerBaseAccountIds: normalizedLedgerAccountIds,
    exchangeBaseBalance: input.exchangeBaseBalance,
    currentPrice: input.currentPrice,
    exchangeObservationHash,
    observedAt,
  }
}

async function loadPosition(
  env: FillAccountingReconciliationStoreEnv,
  input: PersistFillAccountingReconciliationInput,
): Promise<AccountingReconciliationPosition> {
  const row = await env.DB.prepare(`
    SELECT quantity, total_cost_basis_quote, average_entry_price,
           cumulative_realized_pnl_quote, status
      FROM live_position_accounting
     WHERE exchange_account_id = ? AND product_id = ?
     LIMIT 1
  `).bind(input.exchangeAccountId, input.productId).first<PositionRow>()
  if (!row) {
    throw new FillAccountingReconciliationUnavailableError(
      'position accounting projection is missing',
    )
  }
  return Object.freeze({
    quantity: asDecimalString(row.quantity, 'position.quantity'),
    totalCostBasisQuote: asDecimalString(
      row.total_cost_basis_quote,
      'position.totalCostBasisQuote',
    ),
    averageEntryPrice: row.average_entry_price === null
      ? null
      : asDecimalString(row.average_entry_price, 'position.averageEntryPrice'),
    cumulativeRealizedPnlQuote: asSignedDecimalString(
      row.cumulative_realized_pnl_quote,
      'position.cumulativeRealizedPnlQuote',
    ),
    status: row.status,
  })
}

async function loadLots(
  env: FillAccountingReconciliationStoreEnv,
  input: PersistFillAccountingReconciliationInput,
): Promise<readonly AccountingReconciliationLot[]> {
  const lots = await env.DB.prepare(`
    SELECT lot_id, original_quantity, original_cost_quote
      FROM live_cost_basis_lots
     WHERE exchange_account_id = ? AND product_id = ?
     ORDER BY acquired_at ASC, lot_id ASC
  `).bind(input.exchangeAccountId, input.productId).all<LotRow>()
  const consumptions = await env.DB.prepare(`
    SELECT c.lot_id, c.quantity, c.cost_basis_quote
      FROM live_cost_basis_consumptions c
      JOIN live_cost_basis_lots l ON l.lot_id = c.lot_id
     WHERE l.exchange_account_id = ? AND l.product_id = ?
     ORDER BY c.consumed_at ASC, c.consumption_id ASC
  `).bind(input.exchangeAccountId, input.productId).all<ConsumptionRow>()

  const consumedByLot = new Map<string, { quantity: DecimalString; cost: DecimalString }>()
  for (const row of consumptions.results) {
    const current = consumedByLot.get(row.lot_id) ?? { quantity: ZERO, cost: ZERO }
    current.quantity = addDecimal(
      current.quantity,
      asDecimalString(row.quantity, 'consumption.quantity'),
    )
    current.cost = addDecimal(
      current.cost,
      asDecimalString(row.cost_basis_quote, 'consumption.costBasisQuote'),
    )
    consumedByLot.set(row.lot_id, current)
  }

  return Object.freeze(lots.results.map((row) => {
    const originalQuantity = asDecimalString(row.original_quantity, 'lot.originalQuantity')
    const originalCost = asDecimalString(row.original_cost_quote, 'lot.originalCostQuote')
    const consumed = consumedByLot.get(row.lot_id) ?? { quantity: ZERO, cost: ZERO }
    if (
      compareDecimal(consumed.quantity, originalQuantity) > 0
      || compareDecimal(consumed.cost, originalCost) > 0
    ) {
      throw new FillAccountingReconciliationConflictError(`lot ${row.lot_id} is over-consumed`)
    }
    return Object.freeze({
      lotId: row.lot_id,
      remainingQuantity: subtractNonNegativeDecimal(
        originalQuantity,
        consumed.quantity,
        'lot.remainingQuantity',
      ),
      remainingCostQuote: subtractNonNegativeDecimal(
        originalCost,
        consumed.cost,
        'lot.remainingCostQuote',
      ),
    })
  }))
}

async function loadRealizedPnl(
  env: FillAccountingReconciliationStoreEnv,
  input: PersistFillAccountingReconciliationInput,
): Promise<readonly SignedDecimalString[]> {
  const rows = await env.DB.prepare(`
    SELECT realized_pnl_quote
      FROM live_realized_pnl_events
     WHERE exchange_account_id = ? AND product_id = ?
     ORDER BY realized_at ASC, realized_pnl_event_id ASC
  `).bind(input.exchangeAccountId, input.productId).all<RealizedPnlRow>()
  return Object.freeze(rows.results.map((row) => (
    asSignedDecimalString(row.realized_pnl_quote, 'realizedPnlQuote')
  )))
}

async function loadLedgerBalance(
  env: FillAccountingReconciliationStoreEnv,
  normalizedLedgerAccountIds: readonly string[],
  baseAsset: string,
): Promise<SignedDecimalString> {
  const placeholders = normalizedLedgerAccountIds.map(() => '?').join(', ')
  const rows = await env.DB.prepare(`
    SELECT direction, amount
      FROM ledger_entries
     WHERE ledger_account_id IN (${placeholders})
       AND asset = ?
     ORDER BY created_at ASC, entry_id ASC
  `).bind(...normalizedLedgerAccountIds, baseAsset).all<LedgerEntryRow>()
  return calculateSignedLedgerBalance(rows.results.map((row) => ({
    direction: row.direction,
    amount: asDecimalString(row.amount, 'ledgerEntry.amount'),
  })))
}

function receiptQuery(): string {
  return `
    SELECT input_hash, reconciliation_hash, status, reasons_json,
           reconstructed_quantity, reconstructed_cost_basis_quote,
           reconstructed_average_entry_price,
           reconstructed_realized_pnl_quote, ledger_base_inventory_balance,
           exchange_base_balance, current_price, market_value_quote,
           unrealized_pnl_quote, provider_mutation_allowed,
           reservation_applied, execution_allowed
      FROM live_fill_accounting_reconciliations
     WHERE reconciliation_id = ?
     LIMIT 1
  `
}

function replayResult(
  reconciliationId: string,
  exchangeName: CanonicalExecutionExchange,
  row: ReconciliationReceiptRow,
): PersistFillAccountingReconciliationResult {
  assertReceiptLocks(row)
  return Object.freeze({
    reconciliationId,
    projectionStatus: 'REPLAYED',
    exchangeName,
    status: row.status,
    reasons: parseReasons(row.reasons_json),
    reconstructedQuantity: asDecimalString(
      row.reconstructed_quantity,
      'receipt.reconstructedQuantity',
    ),
    reconstructedCostBasisQuote: asDecimalString(
      row.reconstructed_cost_basis_quote,
      'receipt.reconstructedCostBasisQuote',
    ),
    reconstructedAverageEntryPrice: row.reconstructed_average_entry_price === null
      ? null
      : asDecimalString(
        row.reconstructed_average_entry_price,
        'receipt.reconstructedAverageEntryPrice',
      ),
    reconstructedRealizedPnlQuote: asSignedDecimalString(
      row.reconstructed_realized_pnl_quote,
      'receipt.reconstructedRealizedPnlQuote',
    ),
    ledgerBaseInventoryBalance: asSignedDecimalString(
      row.ledger_base_inventory_balance,
      'receipt.ledgerBaseInventoryBalance',
    ),
    exchangeBaseBalance: row.exchange_base_balance === null
      ? null
      : asDecimalString(row.exchange_base_balance, 'receipt.exchangeBaseBalance'),
    currentPrice: row.current_price === null
      ? null
      : asDecimalString(row.current_price, 'receipt.currentPrice'),
    marketValueQuote: row.market_value_quote === null
      ? null
      : asDecimalString(row.market_value_quote, 'receipt.marketValueQuote'),
    unrealizedPnlQuote: row.unrealized_pnl_quote === null
      ? null
      : asSignedDecimalString(row.unrealized_pnl_quote, 'receipt.unrealizedPnlQuote'),
    reconciliationHash: row.reconciliation_hash,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}

export async function persistFillAccountingReconciliation(
  env: FillAccountingReconciliationStoreEnv,
  input: PersistFillAccountingReconciliationInput,
): Promise<PersistFillAccountingReconciliationResult> {
  const reconciliationId = required(input.reconciliationId, 'reconciliationId')
  const exchangeName = normalizeExecutionExchange(input.exchangeName)
  const exchangeAccountId = required(input.exchangeAccountId, 'exchangeAccountId')
  const productId = required(input.productId, 'productId')
  const baseAsset = asset(input.baseAsset, 'baseAsset')
  const quoteAsset = asset(input.quoteAsset, 'quoteAsset')
  if (baseAsset === quoteAsset) throw new TypeError('baseAsset and quoteAsset must differ')
  const normalizedLedgerAccountIds = ledgerAccountIds(input.ledgerBaseAccountIds)
  const exchangeObservationHash = optionalHash(
    input.exchangeObservationHash,
    'exchangeObservationHash',
  )
  const exchangeBaseBalance = optionalDecimal(
    input.exchangeBaseBalance,
    'exchangeBaseBalance',
  )
  const currentPrice = optionalDecimal(input.currentPrice, 'currentPrice')
  const observedAt = iso(input.observedAt, 'observedAt')
  const normalizedInput: PersistFillAccountingReconciliationInput = {
    ...input,
    exchangeName,
    exchangeAccountId,
    productId,
    baseAsset,
    quoteAsset,
    ledgerBaseAccountIds: normalizedLedgerAccountIds,
    exchangeBaseBalance,
    currentPrice,
    exchangeObservationHash,
    observedAt,
  }
  const inputHash = await canonicalHash(stableInput(
    normalizedInput,
    exchangeName,
    normalizedLedgerAccountIds,
    exchangeObservationHash,
    observedAt,
  ))

  const existing = await env.DB.prepare(receiptQuery())
    .bind(reconciliationId)
    .first<ReconciliationReceiptRow>()

  if (existing) {
    if (existing.input_hash !== inputHash) {
      throw new FillAccountingReconciliationConflictError(
        'reconciliation ID was already used with different evidence',
      )
    }
    return replayResult(reconciliationId, exchangeName, existing)
  }

  const position = await loadPosition(env, normalizedInput)
  const lots = await loadLots(env, normalizedInput)
  const realizedPnlEvents = await loadRealizedPnl(env, normalizedInput)
  const ledgerBaseInventoryBalance = await loadLedgerBalance(
    env,
    normalizedLedgerAccountIds,
    baseAsset,
  )
  const result = await reconcileFillAccounting({
    reconciliationId,
    exchangeName,
    exchangeAccountId,
    productId,
    baseAsset,
    quoteAsset,
    position,
    lots,
    realizedPnlEvents,
    ledgerBaseInventoryBalance,
    exchangeBaseBalance,
    currentPrice,
    observedAt,
  })

  await env.DB.prepare(`
    INSERT INTO live_fill_accounting_reconciliations (
      reconciliation_id, exchange_name, exchange_account_id, product_id,
      base_asset, quote_asset, input_hash, ledger_account_ids_json,
      exchange_observation_hash, status, reasons_json, position_quantity,
      reconstructed_quantity, position_cost_basis_quote,
      reconstructed_cost_basis_quote, reconstructed_average_entry_price,
      position_realized_pnl_quote, reconstructed_realized_pnl_quote,
      ledger_base_inventory_balance, exchange_base_balance, current_price,
      market_value_quote, unrealized_pnl_quote, reconciliation_hash,
      provider_mutation_allowed, reservation_applied, execution_allowed,
      observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
  `).bind(
    reconciliationId,
    exchangeName,
    exchangeAccountId,
    productId,
    baseAsset,
    quoteAsset,
    inputHash,
    canonicalJson(normalizedLedgerAccountIds),
    exchangeObservationHash,
    result.status,
    canonicalJson(result.reasons),
    position.quantity,
    result.reconstructedQuantity,
    position.totalCostBasisQuote,
    result.reconstructedCostBasisQuote,
    result.reconstructedAverageEntryPrice,
    position.cumulativeRealizedPnlQuote,
    result.reconstructedRealizedPnlQuote,
    result.ledgerBaseInventoryBalance,
    result.exchangeBaseBalance,
    result.currentPrice,
    result.marketValueQuote,
    result.unrealizedPnlQuote,
    result.reconciliationHash,
    observedAt,
  ).run()

  const projected = await env.DB.prepare(receiptQuery())
    .bind(reconciliationId)
    .first<ReconciliationReceiptRow>()
  if (!projected) {
    throw new Error('fill-accounting reconciliation receipt is missing after insert')
  }
  assertReceiptLocks(projected)
  if (
    projected.input_hash !== inputHash
    || projected.reconciliation_hash !== result.reconciliationHash
    || projected.status !== result.status
    || canonicalJson(parseReasons(projected.reasons_json)) !== canonicalJson(result.reasons)
    || projected.reconstructed_quantity !== result.reconstructedQuantity
    || projected.reconstructed_cost_basis_quote !== result.reconstructedCostBasisQuote
    || projected.reconstructed_average_entry_price !== result.reconstructedAverageEntryPrice
    || projected.reconstructed_realized_pnl_quote !== result.reconstructedRealizedPnlQuote
    || projected.ledger_base_inventory_balance !== result.ledgerBaseInventoryBalance
    || projected.exchange_base_balance !== result.exchangeBaseBalance
    || projected.current_price !== result.currentPrice
    || projected.market_value_quote !== result.marketValueQuote
    || projected.unrealized_pnl_quote !== result.unrealizedPnlQuote
  ) {
    throw new FillAccountingReconciliationConflictError(
      'fill-accounting reconciliation receipt verification failed',
    )
  }

  return Object.freeze({
    ...result,
    projectionStatus: 'PROJECTED',
    exchangeName,
  })
}
