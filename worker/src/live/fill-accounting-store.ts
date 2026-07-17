import { canonicalHash } from './canonical-json.ts'
import {
  accountSpotFillFifo,
  type CostBasisLotState,
  type FillAccountingAccounts,
  type FillAccountingResult,
} from './fill-accounting.ts'
import type { ExchangeFillSnapshot } from './exchange-contracts.ts'
import {
  addDecimal,
  asDecimalString,
  asSignedDecimalString,
  compareDecimal,
  subtractNonNegativeDecimal,
  type DecimalString,
  type SignedDecimalString,
} from './decimal.ts'

export interface FillAccountingStoreEnv {
  DB: D1Database
}

export interface PersistSpotFillAccountingInput {
  exchangeAccountId: string
  internalOrderId: string
  correlationId: string
  baseAsset: string
  quoteAsset: string
  fill: ExchangeFillSnapshot
  feeQuoteValue: DecimalString | null
  accounts: FillAccountingAccounts
  rawResponseHash: string
}

export interface PersistSpotFillAccountingResult {
  status: 'PROJECTED' | 'REPLAYED'
  accountingReceiptId: string
  fillId: string
  journalId: string
  accountingHash: string
  positionQuantity: DecimalString
  cumulativeRealizedPnlQuote: SignedDecimalString
  providerMutationAllowed: false
  reservationApplied: false
  executionAllowed: false
}

export class FillAccountingConflictError extends Error {
  readonly code = 'FILL_ACCOUNTING_CONFLICT'

  constructor(message: string) {
    super(message)
    this.name = 'FillAccountingConflictError'
  }
}

type AccountingReceiptRow = {
  input_hash: string
  accounting_hash: string
  journal_id: string
}

type ExistingFillRow = {
  trade_id: string
  exchange_account_id: string
  internal_order_id: string
  exchange_order_id: string
  product_id: string
  side: string
  price: string
  base_size: string
  commission: string
  commission_asset: string | null
  trade_time: string
  sequence_timestamp: string
  raw_response_hash: string
}

type ExistingJournalRow = {
  exchange_account_id: string
  event_type: string
  reference_type: string
  reference_id: string
  correlation_id: string
  idempotency_key: string
}

type LotRow = {
  lot_id: string
  exchange_account_id: string
  product_id: string
  base_asset: string
  quote_asset: string
  acquired_fill_id: string
  acquired_at: string
  original_quantity: string
  original_cost_quote: string
  unit_cost_quote: string
  method: string
}

type ConsumptionRow = {
  lot_id: string
  quantity: string
  cost_basis_quote: string
}

type PositionRow = {
  cumulative_realized_pnl_quote: string
}

const ZERO = asDecimalString('0')

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

function hash(value: string, field: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${field} must be a lowercase SHA-256 hash`)
  }
  return normalized
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new TypeError(`${field} must be ISO-8601`)
  return new Date(parsed).toISOString()
}

function deterministicIds(fillId: string): {
  receiptId: string
  journalId: string
  acquisitionLotId: string
  idempotencyKey: string
} {
  const normalized = required(fillId, 'fill.fillId')
  return {
    receiptId: `fill-accounting-receipt:${normalized}`,
    journalId: `fill-accounting-journal:${normalized}`,
    acquisitionLotId: `fifo-lot:${normalized}`,
    idempotencyKey: `fill-accounting:${normalized}`,
  }
}

function stableInput(input: PersistSpotFillAccountingInput): unknown {
  return {
    exchangeAccountId: input.exchangeAccountId,
    internalOrderId: input.internalOrderId,
    correlationId: input.correlationId,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
    fill: input.fill,
    feeQuoteValue: input.feeQuoteValue,
    accounts: input.accounts,
    rawResponseHash: input.rawResponseHash,
  }
}

async function inputHash(input: PersistSpotFillAccountingInput): Promise<string> {
  return canonicalHash(stableInput(input))
}

function existingFillMatches(
  row: ExistingFillRow,
  input: PersistSpotFillAccountingInput,
  rawResponseHash: string,
): boolean {
  const fill = input.fill
  return row.trade_id === fill.tradeId
    && row.exchange_account_id === input.exchangeAccountId
    && row.internal_order_id === input.internalOrderId
    && row.exchange_order_id === fill.exchangeOrderId
    && row.product_id === fill.productId
    && row.side === fill.side
    && row.price === fill.price
    && row.base_size === fill.baseSize
    && row.commission === fill.commission
    && row.commission_asset === fill.commissionAsset
    && row.trade_time === iso(fill.tradeTime, 'fill.tradeTime')
    && row.sequence_timestamp === iso(fill.sequenceTimestamp, 'fill.sequenceTimestamp')
    && row.raw_response_hash === rawResponseHash
}

async function assertExistingFillCompatible(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
  rawResponseHash: string,
): Promise<void> {
  const row = await env.DB.prepare(`
    SELECT trade_id, exchange_account_id, internal_order_id, exchange_order_id,
           product_id, side, price, base_size, commission, commission_asset,
           trade_time, sequence_timestamp, raw_response_hash
      FROM live_fills
     WHERE fill_id = ?
     LIMIT 1
  `).bind(input.fill.fillId).first<ExistingFillRow>()

  if (row && !existingFillMatches(row, input, rawResponseHash)) {
    throw new FillAccountingConflictError('existing fill projection conflicts with accounting input')
  }
}

async function assertExistingJournalCompatible(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
  journalId: string,
  idempotencyKey: string,
): Promise<void> {
  const row = await env.DB.prepare(`
    SELECT exchange_account_id, event_type, reference_type, reference_id,
           correlation_id, idempotency_key
      FROM ledger_journals
     WHERE journal_id = ?
     LIMIT 1
  `).bind(journalId).first<ExistingJournalRow>()

  if (!row) return
  if (
    row.exchange_account_id !== input.exchangeAccountId
    || row.event_type !== 'SPOT_FILL_POSTED'
    || row.reference_type !== 'FILL'
    || row.reference_id !== input.fill.fillId
    || row.correlation_id !== input.correlationId
    || row.idempotency_key !== idempotencyKey
  ) {
    throw new FillAccountingConflictError('existing ledger journal conflicts with accounting input')
  }
}

async function loadOpenLots(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
): Promise<readonly CostBasisLotState[]> {
  const lotRows = await env.DB.prepare(`
    SELECT lot_id, exchange_account_id, product_id, base_asset, quote_asset,
           acquired_fill_id, acquired_at, original_quantity,
           original_cost_quote, unit_cost_quote, method
      FROM live_cost_basis_lots
     WHERE exchange_account_id = ? AND product_id = ?
     ORDER BY acquired_at ASC, lot_id ASC
  `).bind(input.exchangeAccountId, input.fill.productId).all<LotRow>()

  const consumptionRows = await env.DB.prepare(`
    SELECT c.lot_id, c.quantity, c.cost_basis_quote
      FROM live_cost_basis_consumptions c
      JOIN live_cost_basis_lots l ON l.lot_id = c.lot_id
     WHERE l.exchange_account_id = ? AND l.product_id = ?
     ORDER BY c.consumed_at ASC, c.consumption_id ASC
  `).bind(input.exchangeAccountId, input.fill.productId).all<ConsumptionRow>()

  const consumedByLot = new Map<string, { quantity: DecimalString; cost: DecimalString }>()
  for (const row of consumptionRows.results) {
    const current = consumedByLot.get(row.lot_id) ?? { quantity: ZERO, cost: ZERO }
    current.quantity = addDecimal(current.quantity, asDecimalString(row.quantity, 'consumption.quantity'))
    current.cost = addDecimal(current.cost, asDecimalString(row.cost_basis_quote, 'consumption.costBasisQuote'))
    consumedByLot.set(row.lot_id, current)
  }

  return Object.freeze(lotRows.results.map((row) => {
    if (row.method !== 'FIFO') throw new FillAccountingConflictError(`unsupported lot method: ${row.method}`)
    const originalQuantity = asDecimalString(row.original_quantity, 'lot.originalQuantity')
    const originalCostQuote = asDecimalString(row.original_cost_quote, 'lot.originalCostQuote')
    const consumed = consumedByLot.get(row.lot_id) ?? { quantity: ZERO, cost: ZERO }
    if (
      compareDecimal(consumed.quantity, originalQuantity) > 0
      || compareDecimal(consumed.cost, originalCostQuote) > 0
    ) {
      throw new FillAccountingConflictError(`lot ${row.lot_id} is over-consumed`)
    }
    return Object.freeze({
      lotId: row.lot_id,
      exchangeAccountId: row.exchange_account_id,
      productId: row.product_id,
      baseAsset: row.base_asset,
      quoteAsset: row.quote_asset,
      acquiredFillId: row.acquired_fill_id,
      acquiredAt: iso(row.acquired_at, 'lot.acquiredAt'),
      originalQuantity,
      remainingQuantity: subtractNonNegativeDecimal(
        originalQuantity,
        consumed.quantity,
        'lot.remainingQuantity',
      ),
      originalCostQuote,
      remainingCostQuote: subtractNonNegativeDecimal(
        originalCostQuote,
        consumed.cost,
        'lot.remainingCostQuote',
      ),
      unitCostQuote: asDecimalString(row.unit_cost_quote, 'lot.unitCostQuote'),
      method: 'FIFO' as const,
    })
  }))
}

async function loadCumulativeRealizedPnl(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
): Promise<SignedDecimalString> {
  const row = await env.DB.prepare(`
    SELECT cumulative_realized_pnl_quote
      FROM live_position_accounting
     WHERE exchange_account_id = ? AND product_id = ?
     LIMIT 1
  `).bind(input.exchangeAccountId, input.fill.productId).first<PositionRow>()
  return asSignedDecimalString(row?.cumulative_realized_pnl_quote ?? '0', 'cumulativeRealizedPnlQuote')
}

function fillStatement(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
  rawResponseHash: string,
): D1PreparedStatement {
  const quoteValue = multiplyDecimal(input.fill.price, input.fill.baseSize)
  return env.DB.prepare(`
    INSERT OR IGNORE INTO live_fills (
      fill_id, trade_id, exchange_account_id, internal_order_id,
      exchange_order_id, product_id, side, price, base_size, quote_value,
      commission, commission_asset, trade_time, sequence_timestamp,
      raw_response_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.fill.fillId,
    input.fill.tradeId,
    input.exchangeAccountId,
    input.internalOrderId,
    input.fill.exchangeOrderId,
    input.fill.productId,
    input.fill.side,
    input.fill.price,
    input.fill.baseSize,
    quoteValue,
    input.fill.commission,
    input.fill.commissionAsset,
    iso(input.fill.tradeTime, 'fill.tradeTime'),
    iso(input.fill.sequenceTimestamp, 'fill.sequenceTimestamp'),
    rawResponseHash,
  )
}

function journalStatements(
  env: FillAccountingStoreEnv,
  result: FillAccountingResult,
): D1PreparedStatement[] {
  const journal = result.journal
  return [
    env.DB.prepare(`
      INSERT INTO ledger_journals (
        journal_id, exchange_account_id, event_type, reference_type,
        reference_id, correlation_id, idempotency_key, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'POSTED')
    `).bind(
      journal.journalId,
      journal.exchangeAccountId,
      journal.eventType,
      journal.referenceType,
      journal.referenceId,
      journal.correlationId,
      journal.idempotencyKey,
    ),
    ...journal.entries.map((entry) => env.DB.prepare(`
      INSERT INTO ledger_entries (
        entry_id, journal_id, ledger_account_id, asset, direction, amount
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      entry.entryId,
      journal.journalId,
      entry.ledgerAccountId,
      entry.asset,
      entry.direction,
      entry.amount,
    )),
  ]
}

function accountingStatements(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
  result: FillAccountingResult,
  receiptId: string,
  requestHash: string,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []

  if (result.acquiredLot) {
    statements.push(env.DB.prepare(`
      INSERT INTO live_cost_basis_lots (
        lot_id, exchange_account_id, product_id, base_asset, quote_asset,
        acquired_fill_id, acquired_at, original_quantity, original_cost_quote,
        unit_cost_quote, method, accounting_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FIFO', ?)
    `).bind(
      result.acquiredLot.lotId,
      result.acquiredLot.exchangeAccountId,
      result.acquiredLot.productId,
      result.acquiredLot.baseAsset,
      result.acquiredLot.quoteAsset,
      result.acquiredLot.acquiredFillId,
      result.acquiredLot.acquiredAt,
      result.acquiredLot.originalQuantity,
      result.acquiredLot.originalCostQuote,
      result.acquiredLot.unitCostQuote,
      result.accountingHash,
    ))
  }

  for (const consumption of result.lotConsumptions) {
    statements.push(env.DB.prepare(`
      INSERT INTO live_cost_basis_consumptions (
        consumption_id, lot_id, disposal_fill_id, quantity,
        cost_basis_quote, consumed_at, method, accounting_hash
      ) VALUES (?, ?, ?, ?, ?, ?, 'FIFO', ?)
    `).bind(
      consumption.consumptionId,
      consumption.lotId,
      consumption.disposalFillId,
      consumption.quantity,
      consumption.costBasisQuote,
      consumption.consumedAt,
      result.accountingHash,
    ))
  }

  if (result.realizedPnlEvent) {
    const event = result.realizedPnlEvent
    statements.push(env.DB.prepare(`
      INSERT INTO live_realized_pnl_events (
        realized_pnl_event_id, exchange_account_id, internal_order_id,
        fill_id, product_id, base_asset, quote_asset, disposed_quantity,
        gross_proceeds_quote, fee_quote_value, net_proceeds_quote,
        cost_basis_quote, realized_pnl_quote, method, realized_at,
        accounting_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FIFO', ?, ?)
    `).bind(
      event.realizedPnlEventId,
      event.exchangeAccountId,
      event.internalOrderId,
      event.fillId,
      event.productId,
      event.baseAsset,
      event.quoteAsset,
      event.disposedQuantity,
      event.grossProceedsQuote,
      event.feeQuoteValue,
      event.netProceedsQuote,
      event.costBasisQuote,
      event.realizedPnlQuote,
      event.realizedAt,
      result.accountingHash,
    ))
  }

  const position = result.position
  statements.push(env.DB.prepare(`
    INSERT INTO live_position_accounting (
      exchange_account_id, product_id, base_asset, quote_asset, quantity,
      total_cost_basis_quote, average_entry_price,
      cumulative_realized_pnl_quote, current_price, market_value_quote,
      unrealized_pnl_quote, status, last_accounting_hash, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(exchange_account_id, product_id) DO UPDATE SET
      base_asset = excluded.base_asset,
      quote_asset = excluded.quote_asset,
      quantity = excluded.quantity,
      total_cost_basis_quote = excluded.total_cost_basis_quote,
      average_entry_price = excluded.average_entry_price,
      cumulative_realized_pnl_quote = excluded.cumulative_realized_pnl_quote,
      current_price = excluded.current_price,
      market_value_quote = excluded.market_value_quote,
      unrealized_pnl_quote = excluded.unrealized_pnl_quote,
      status = excluded.status,
      last_accounting_hash = excluded.last_accounting_hash,
      observed_at = excluded.observed_at,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    position.exchangeAccountId,
    position.productId,
    position.baseAsset,
    position.quoteAsset,
    position.quantity,
    position.totalCostBasisQuote,
    position.averageEntryPrice,
    position.cumulativeRealizedPnlQuote,
    position.currentPrice,
    position.marketValueQuote,
    position.unrealizedPnlQuote,
    position.status,
    result.accountingHash,
    position.observedAt,
  ))

  statements.push(env.DB.prepare(`
    INSERT INTO live_fill_accounting_receipts (
      accounting_receipt_id, fill_id, exchange_account_id,
      internal_order_id, product_id, method, input_hash, accounting_hash,
      journal_id, provider_mutation_allowed, reservation_applied,
      execution_allowed, accounted_at
    ) VALUES (?, ?, ?, ?, ?, 'FIFO', ?, ?, ?, 0, 0, 0, ?)
  `).bind(
    receiptId,
    input.fill.fillId,
    input.exchangeAccountId,
    input.internalOrderId,
    input.fill.productId,
    requestHash,
    result.accountingHash,
    result.journal.journalId,
    iso(input.fill.sequenceTimestamp, 'fill.sequenceTimestamp'),
  ))

  return statements
}

export async function persistSpotFillAccountingFifo(
  env: FillAccountingStoreEnv,
  input: PersistSpotFillAccountingInput,
): Promise<PersistSpotFillAccountingResult> {
  required(input.exchangeAccountId, 'exchangeAccountId')
  required(input.internalOrderId, 'internalOrderId')
  required(input.correlationId, 'correlationId')
  const baseAsset = asset(input.baseAsset, 'baseAsset')
  const quoteAsset = asset(input.quoteAsset, 'quoteAsset')
  if (baseAsset === quoteAsset) throw new TypeError('baseAsset and quoteAsset must differ')
  if (input.fill.productId.trim() === '') throw new TypeError('fill.productId is required')
  const rawResponseHash = hash(input.rawResponseHash, 'rawResponseHash')
  const ids = deterministicIds(input.fill.fillId)
  const requestHash = await inputHash({ ...input, baseAsset, quoteAsset, rawResponseHash })

  const existing = await env.DB.prepare(`
    SELECT input_hash, accounting_hash, journal_id
      FROM live_fill_accounting_receipts
     WHERE fill_id = ?
     LIMIT 1
  `).bind(input.fill.fillId).first<AccountingReceiptRow>()

  if (existing) {
    if (existing.input_hash !== requestHash || existing.journal_id !== ids.journalId) {
      throw new FillAccountingConflictError('fill accounting receipt conflicts with request')
    }
    return Object.freeze({
      status: 'REPLAYED',
      accountingReceiptId: ids.receiptId,
      fillId: input.fill.fillId,
      journalId: existing.journal_id,
      accountingHash: existing.accounting_hash,
      positionQuantity: ZERO,
      cumulativeRealizedPnlQuote: asSignedDecimalString('0'),
      providerMutationAllowed: false,
      reservationApplied: false,
      executionAllowed: false,
    })
  }

  await assertExistingFillCompatible(env, input, rawResponseHash)
  await assertExistingJournalCompatible(env, input, ids.journalId, ids.idempotencyKey)

  const existingLots = await loadOpenLots(env, input)
  const cumulativeRealizedPnlQuote = await loadCumulativeRealizedPnl(env, input)
  const result = await accountSpotFillFifo({
    journalId: ids.journalId,
    exchangeAccountId: input.exchangeAccountId,
    internalOrderId: input.internalOrderId,
    correlationId: input.correlationId,
    idempotencyKey: ids.idempotencyKey,
    baseAsset,
    quoteAsset,
    fill: input.fill,
    existingLots,
    cumulativeRealizedPnlQuote,
    feeQuoteValue: input.feeQuoteValue,
    acquisitionLotId: ids.acquisitionLotId,
    accounts: input.accounts,
  })

  const statements = [
    fillStatement(env, input, rawResponseHash),
    ...journalStatements(env, result),
    ...accountingStatements(env, input, result, ids.receiptId, requestHash),
  ]
  await env.DB.batch(statements)

  const projected = await env.DB.prepare(`
    SELECT input_hash, accounting_hash, journal_id
      FROM live_fill_accounting_receipts
     WHERE fill_id = ?
     LIMIT 1
  `).bind(input.fill.fillId).first<AccountingReceiptRow>()
  if (!projected) throw new Error('fill accounting receipt is missing after D1 batch')
  if (
    projected.input_hash !== requestHash
    || projected.accounting_hash !== result.accountingHash
    || projected.journal_id !== result.journal.journalId
  ) {
    throw new FillAccountingConflictError('fill accounting receipt verification failed')
  }

  return Object.freeze({
    status: 'PROJECTED',
    accountingReceiptId: ids.receiptId,
    fillId: input.fill.fillId,
    journalId: result.journal.journalId,
    accountingHash: result.accountingHash,
    positionQuantity: result.position.quantity,
    cumulativeRealizedPnlQuote: result.position.cumulativeRealizedPnlQuote,
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
  })
}
