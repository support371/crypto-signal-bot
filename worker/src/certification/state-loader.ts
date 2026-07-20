import { canonicalJson } from '../live/canonical-json.ts'
import {
  asDecimalString,
  asSignedDecimalString,
  type SignedDecimalString,
} from '../live/decimal.ts'
import type { CostBasisLotState } from '../live/fill-accounting.ts'
import {
  verifyCertificationFillSimulationEvidence,
  type CertificationFillSimulation,
} from './fill-simulation.ts'

export interface CertificationStateLoaderEnv {
  DB: D1Database
}

type StateRow = Record<string, unknown> & {
  evidence_json: string
  simulation_hash: string
  simulated_at: string
  provider_order_created: number
  provider_fill_claimed: number
  reservation_applied: number
  automatically_persisted: number
  provider_mutation_allowed: number
  execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
}

export type CertificationSimulationStateSnapshot = Readonly<{
  exchangeAccountId: string
  productId: string
  existingLots: readonly CostBasisLotState[]
  cumulativeRealizedPnlQuote: SignedDecimalString
  lastSimulatedAt: string | null
  source: 'EMPTY' | 'IMMUTABLE_CERTIFICATION_EVIDENCE'
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}>

export class CertificationStateLoaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CertificationStateLoaderError'
  }
}

function identifier(value: string, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!/^[A-Za-z0-9:._-]{1,128}$/.test(normalized)) {
    throw new CertificationStateLoaderError(`${field} is invalid`)
  }
  return normalized
}

function empty(exchangeAccountId: string, productId: string): CertificationSimulationStateSnapshot {
  return Object.freeze({
    exchangeAccountId,
    productId,
    existingLots: Object.freeze([]),
    cumulativeRealizedPnlQuote: asSignedDecimalString('0'),
    lastSimulatedAt: null,
    source: 'EMPTY',
    providerMutationAllowed: false,
    executionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

function assertRowLocks(row: StateRow): void {
  if ([
    row.provider_order_created,
    row.provider_fill_claimed,
    row.reservation_applied,
    row.automatically_persisted,
    row.provider_mutation_allowed,
    row.execution_allowed,
    row.real_funds_allowed,
    row.mainnet_allowed,
    row.withdrawals_allowed,
  ].some((value) => value !== 0)) {
    throw new CertificationStateLoaderError('stored simulation state violates capability locks')
  }
}

function parseSimulation(value: string): CertificationFillSimulation {
  try {
    const parsed = JSON.parse(value) as CertificationFillSimulation
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    return parsed
  } catch {
    throw new CertificationStateLoaderError('stored simulation evidence JSON is malformed')
  }
}

function validateLot(
  lot: CostBasisLotState,
  exchangeAccountId: string,
  productId: string,
): CostBasisLotState {
  if (lot.exchangeAccountId !== exchangeAccountId || lot.productId !== productId || lot.method !== 'FIFO') {
    throw new CertificationStateLoaderError('stored FIFO lot scope is invalid')
  }
  const normalized = Object.freeze({
    ...lot,
    originalQuantity: asDecimalString(lot.originalQuantity, 'lot.originalQuantity'),
    remainingQuantity: asDecimalString(lot.remainingQuantity, 'lot.remainingQuantity'),
    originalCostQuote: asDecimalString(lot.originalCostQuote, 'lot.originalCostQuote'),
    remainingCostQuote: asDecimalString(lot.remainingCostQuote, 'lot.remainingCostQuote'),
    unitCostQuote: asDecimalString(lot.unitCostQuote, 'lot.unitCostQuote'),
  })
  if (canonicalJson(normalized) !== canonicalJson(lot)) {
    throw new CertificationStateLoaderError('stored FIFO lot decimals are not canonical')
  }
  return normalized
}

/** Load only the latest immutable, hash-verified FIFO state for one account/product. */
export async function loadCertificationSimulationState(
  env: CertificationStateLoaderEnv,
  exchangeAccountId: string,
  productId: string,
): Promise<CertificationSimulationStateSnapshot> {
  const account = identifier(exchangeAccountId, 'exchangeAccountId')
  const product = identifier(productId, 'productId')
  const row = await env.DB.prepare(`
    SELECT f.evidence_json, f.simulation_hash, f.simulated_at,
           f.provider_order_created, f.provider_fill_claimed,
           f.reservation_applied, f.automatically_persisted,
           f.provider_mutation_allowed, f.execution_allowed,
           f.real_funds_allowed, f.mainnet_allowed, f.withdrawals_allowed
      FROM live_certification_fill_simulations f
      JOIN live_certification_signal_assessments a
        ON a.assessment_binding_hash = f.assessment_binding_hash
     WHERE a.exchange_account_id = ? AND f.product_id = ?
     ORDER BY f.simulated_at DESC, f.simulation_hash DESC
     LIMIT 1
  `).bind(account, product).first<StateRow>()
  if (!row) return empty(account, product)
  assertRowLocks(row)
  const simulation = parseSimulation(row.evidence_json)
  if (simulation.simulationHash !== row.simulation_hash
    || simulation.fill.productId !== product
    || simulation.accounting.position.exchangeAccountId !== account) {
    throw new CertificationStateLoaderError('stored simulation state identity is invalid')
  }
  await verifyCertificationFillSimulationEvidence(simulation)
  const lots = Object.freeze(simulation.accounting.updatedLots.map(
    (lot) => validateLot(lot, account, product),
  ))
  return Object.freeze({
    exchangeAccountId: account,
    productId: product,
    existingLots: lots,
    cumulativeRealizedPnlQuote: asSignedDecimalString(
      simulation.accounting.position.cumulativeRealizedPnlQuote,
      'cumulativeRealizedPnlQuote',
    ),
    lastSimulatedAt: row.simulated_at,
    source: 'IMMUTABLE_CERTIFICATION_EVIDENCE',
    providerMutationAllowed: false,
    executionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}
