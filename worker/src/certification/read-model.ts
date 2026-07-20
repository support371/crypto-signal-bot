import { asDecimalString, asSignedDecimalString, type DecimalString, type SignedDecimalString } from '../live/decimal.ts'

export interface CertificationReadModelEnv {
  DB: D1Database
}

type CertificationRow = Record<string, unknown> & {
  product_symbol: string
  direction: string
  confidence_bps: number
  reference_price: string
  signal_created_at: string
  side: string
  fill_price: string
  base_size: string
  commission: string
  simulated_at: string
  simulation_json: string
  signal_provider_mutation_allowed: number
  signal_execution_allowed: number
  signal_real_funds_allowed: number
  assessment_reservation_applied: number
  assessment_automatically_submitted: number
  assessment_provider_mutation_allowed: number
  assessment_execution_allowed: number
  assessment_real_funds_allowed: number
  provider_order_created: number
  provider_fill_claimed: number
  simulation_reservation_applied: number
  automatically_persisted: number
  simulation_provider_mutation_allowed: number
  simulation_execution_allowed: number
  simulation_real_funds_allowed: number
  simulation_mainnet_allowed: number
  simulation_withdrawals_allowed: number
}

export type CertificationActivityItem = Readonly<{
  provider: 'BITGET'
  productSymbol: string
  signalDirection: 'BUY' | 'SELL'
  confidenceBps: number
  referencePrice: DecimalString
  signalCreatedAt: string
  side: 'BUY' | 'SELL'
  fillPrice: DecimalString
  baseSize: DecimalString
  commissionQuote: DecimalString
  simulatedAt: string
  positionQuantity: DecimalString
  positionCostBasisQuote: DecimalString
  cumulativeRealizedPnlQuote: SignedDecimalString
  realizedPnlQuote: SignedDecimalString | null
  positionStatus: 'OPEN' | 'CLOSED'
  providerOrderCreated: false
  providerFillClaimed: false
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}>

export type CertificationActivityPage = Readonly<{
  provider: 'BITGET'
  exchangeAccountScoped: true
  count: number
  items: readonly CertificationActivityItem[]
  nextOffset: number | null
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}>

export class CertificationReadModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CertificationReadModelError'
  }
}

function identifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[A-Za-z0-9:._-]{1,128}$/.test(normalized)) {
    throw new CertificationReadModelError(`${field} is invalid`)
  }
  return normalized
}

function pagination(limit: number, offset: number): { limit: number; offset: number } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new CertificationReadModelError('limit must be an integer from 1 to 50')
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
    throw new CertificationReadModelError('offset must be an integer from 0 to 10000')
  }
  return { limit, offset }
}

function iso(value: string, field: string): string {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new CertificationReadModelError(`${field} is not canonical ISO-8601`)
  }
  return value
}

function assertLocks(row: CertificationRow): void {
  const locks = [
    row.signal_provider_mutation_allowed,
    row.signal_execution_allowed,
    row.signal_real_funds_allowed,
    row.assessment_reservation_applied,
    row.assessment_automatically_submitted,
    row.assessment_provider_mutation_allowed,
    row.assessment_execution_allowed,
    row.assessment_real_funds_allowed,
    row.provider_order_created,
    row.provider_fill_claimed,
    row.simulation_reservation_applied,
    row.automatically_persisted,
    row.simulation_provider_mutation_allowed,
    row.simulation_execution_allowed,
    row.simulation_real_funds_allowed,
    row.simulation_mainnet_allowed,
    row.simulation_withdrawals_allowed,
  ]
  if (locks.some((value) => value !== 0)) {
    throw new CertificationReadModelError('stored certification activity violates capability locks')
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CertificationReadModelError(`${field} is malformed`)
  }
  return value as Record<string, unknown>
}

function simulationAccounting(value: string): {
  positionQuantity: DecimalString
  positionCostBasisQuote: DecimalString
  cumulativeRealizedPnlQuote: SignedDecimalString
  realizedPnlQuote: SignedDecimalString | null
  positionStatus: 'OPEN' | 'CLOSED'
} {
  let root: Record<string, unknown>
  try {
    root = object(JSON.parse(value), 'simulation evidence')
  } catch (error) {
    if (error instanceof CertificationReadModelError) throw error
    throw new CertificationReadModelError('simulation evidence JSON is malformed')
  }
  const accounting = object(root.accounting, 'simulation accounting')
  const position = object(accounting.position, 'simulation position')
  const realized = accounting.realizedPnlEvent === null
    ? null
    : object(accounting.realizedPnlEvent, 'realized PnL event')
  if (accounting.providerMutationAllowed !== false
    || accounting.reservationApplied !== false
    || accounting.executionAllowed !== false) {
    throw new CertificationReadModelError('stored accounting evidence violates capability locks')
  }
  if (position.status !== 'OPEN' && position.status !== 'CLOSED') {
    throw new CertificationReadModelError('stored certification position status is invalid')
  }
  return {
    positionQuantity: asDecimalString(position.quantity, 'position.quantity'),
    positionCostBasisQuote: asDecimalString(
      position.totalCostBasisQuote,
      'position.totalCostBasisQuote',
    ),
    cumulativeRealizedPnlQuote: asSignedDecimalString(
      position.cumulativeRealizedPnlQuote,
      'position.cumulativeRealizedPnlQuote',
    ),
    realizedPnlQuote: realized
      ? asSignedDecimalString(realized.realizedPnlQuote, 'realizedPnlQuote')
      : null,
    positionStatus: position.status,
  }
}

function item(row: CertificationRow): CertificationActivityItem {
  assertLocks(row)
  if ((row.direction !== 'BUY' && row.direction !== 'SELL')
    || (row.side !== 'BUY' && row.side !== 'SELL')
    || row.direction !== row.side
    || !Number.isInteger(row.confidence_bps)
    || row.confidence_bps < 0
    || row.confidence_bps > 10_000) {
    throw new CertificationReadModelError('stored certification activity identity is invalid')
  }
  const accounting = simulationAccounting(row.simulation_json)
  return Object.freeze({
    provider: 'BITGET',
    productSymbol: row.product_symbol,
    signalDirection: row.direction,
    confidenceBps: row.confidence_bps,
    referencePrice: asDecimalString(row.reference_price, 'referencePrice'),
    signalCreatedAt: iso(row.signal_created_at, 'signalCreatedAt'),
    side: row.side,
    fillPrice: asDecimalString(row.fill_price, 'fillPrice'),
    baseSize: asDecimalString(row.base_size, 'baseSize'),
    commissionQuote: asDecimalString(row.commission, 'commission'),
    simulatedAt: iso(row.simulated_at, 'simulatedAt'),
    ...accounting,
    providerOrderCreated: false,
    providerFillClaimed: false,
    providerMutationAllowed: false,
    executionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

/** Account-scoped, SELECT-only, sanitized certification activity projection. */
export async function readCertificationActivity(
  env: CertificationReadModelEnv,
  exchangeAccountId: string,
  limit = 20,
  offset = 0,
): Promise<CertificationActivityPage> {
  const account = identifier(exchangeAccountId, 'exchangeAccountId')
  const page = pagination(limit, offset)
  const result = await env.DB.prepare(`
    SELECT s.product_symbol, s.direction, s.confidence_bps,
           s.reference_price, s.created_at AS signal_created_at,
           f.side, f.fill_price, f.base_size, f.commission, f.simulated_at,
           f.evidence_json AS simulation_json,
           s.provider_mutation_allowed AS signal_provider_mutation_allowed,
           s.execution_allowed AS signal_execution_allowed,
           s.real_funds_allowed AS signal_real_funds_allowed,
           a.reservation_applied AS assessment_reservation_applied,
           a.automatically_submitted AS assessment_automatically_submitted,
           a.provider_mutation_allowed AS assessment_provider_mutation_allowed,
           a.execution_allowed AS assessment_execution_allowed,
           a.real_funds_allowed AS assessment_real_funds_allowed,
           f.provider_order_created, f.provider_fill_claimed,
           f.reservation_applied AS simulation_reservation_applied,
           f.automatically_persisted,
           f.provider_mutation_allowed AS simulation_provider_mutation_allowed,
           f.execution_allowed AS simulation_execution_allowed,
           f.real_funds_allowed AS simulation_real_funds_allowed,
           f.mainnet_allowed AS simulation_mainnet_allowed,
           f.withdrawals_allowed AS simulation_withdrawals_allowed
      FROM live_certification_fill_simulations f
      JOIN live_certification_signal_assessments a
        ON a.assessment_binding_hash = f.assessment_binding_hash
      JOIN live_certification_signal_evidence s
        ON s.signal_evidence_hash = f.signal_evidence_hash
     WHERE a.exchange_account_id = ?
     ORDER BY f.simulated_at DESC, f.simulation_hash DESC
     LIMIT ? OFFSET ?
  `).bind(account, page.limit + 1, page.offset).all<CertificationRow>()
  const rows = result.results ?? []
  const hasMore = rows.length > page.limit
  const items = Object.freeze(rows.slice(0, page.limit).map(item))
  return Object.freeze({
    provider: 'BITGET',
    exchangeAccountScoped: true,
    count: items.length,
    items,
    nextOffset: hasMore ? page.offset + page.limit : null,
    providerMutationAllowed: false,
    executionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}
