import { canonicalJson } from '../live/canonical-json.ts'
import {
  assertCertificationFillSimulationVerified,
  type CertificationFillSimulation,
} from './fill-simulation.ts'
import {
  assertCertificationSignalAssessmentVerified,
  type CertificationSignalAssessment,
} from './signal-assessment-bridge.ts'
import {
  verifyCertificationSignalEvidence,
  type CertificationSignalEvidence,
} from './signal-engine.ts'

export interface CertificationEvidenceStoreEnv {
  DB: D1Database
}

export type CertificationEvidenceProjectionReceipt = Readonly<{
  signalEvidenceHash: string
  assessmentBindingHash: string
  simulationHash: string
  projectionStatus: 'PROJECTED' | 'REPLAYED'
  persistedAt: string
  providerMutationAllowed: false
  executionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
}>

type StoredEvidenceRow = Record<string, unknown> & {
  signal_evidence_hash: string
  assessment_binding_hash: string
  simulation_hash: string
  signal_json: string
  assessment_json: string
  simulation_json: string
  persisted_at: string
  signal_provider_mutation_allowed: number
  signal_execution_allowed: number
  signal_real_funds_allowed: number
  signal_mainnet_allowed: number
  signal_withdrawals_allowed: number
  assessment_reservation_applied: number
  assessment_automatically_submitted: number
  assessment_provider_mutation_allowed: number
  assessment_execution_allowed: number
  assessment_real_funds_allowed: number
  assessment_mainnet_allowed: number
  assessment_withdrawals_allowed: number
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

type StoredSignalRow = Record<string, unknown> & {
  signal_evidence_hash: string
  signal_identity_hash: string
  evidence_json: string
  provider_mutation_allowed: number
  execution_allowed: number
  real_funds_allowed: number
  mainnet_allowed: number
  withdrawals_allowed: number
}

export class CertificationEvidenceStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CertificationEvidenceStoreError'
  }
}

function timestamp(value: string, field: string): { iso: string; milliseconds: number } {
  const normalized = String(value ?? '').trim()
  const milliseconds = Date.parse(normalized)
  if (!normalized || !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalized) {
    throw new CertificationEvidenceStoreError(`${field} must be canonical ISO-8601`)
  }
  return { iso: normalized, milliseconds }
}

function assertCrossEvidence(
  signal: CertificationSignalEvidence,
  assessment: CertificationSignalAssessment,
  simulation: CertificationFillSimulation,
): void {
  assertCertificationSignalAssessmentVerified(assessment)
  assertCertificationFillSimulationVerified(simulation)
  if (
    assessment.signalEvidenceHash !== signal.evidenceHash
    || simulation.signalEvidenceHash !== signal.evidenceHash
    || simulation.assessmentBindingHash !== assessment.assessmentBindingHash
    || simulation.fill.productId !== assessment.productId
    || simulation.fill.side !== assessment.side
    || simulation.accounting.accountingHash.length !== 64
  ) {
    throw new CertificationEvidenceStoreError('certification evidence identities do not match')
  }
}

function assertStoredLocks(row: StoredEvidenceRow): void {
  const values = [
    row.signal_provider_mutation_allowed,
    row.signal_execution_allowed,
    row.signal_real_funds_allowed,
    row.signal_mainnet_allowed,
    row.signal_withdrawals_allowed,
    row.assessment_reservation_applied,
    row.assessment_automatically_submitted,
    row.assessment_provider_mutation_allowed,
    row.assessment_execution_allowed,
    row.assessment_real_funds_allowed,
    row.assessment_mainnet_allowed,
    row.assessment_withdrawals_allowed,
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
  if (values.some((value) => value !== 0)) {
    throw new CertificationEvidenceStoreError('stored certification capability locks are invalid')
  }
}

async function loadEvidence(
  env: CertificationEvidenceStoreEnv,
  simulationHash: string,
  assessmentBindingHash: string,
): Promise<StoredEvidenceRow | null> {
  return env.DB.prepare(`
    SELECT s.signal_evidence_hash,
           a.assessment_binding_hash,
           f.simulation_hash,
           s.evidence_json AS signal_json,
           a.evidence_json AS assessment_json,
           f.evidence_json AS simulation_json,
           f.persisted_at,
           s.provider_mutation_allowed AS signal_provider_mutation_allowed,
           s.execution_allowed AS signal_execution_allowed,
           s.real_funds_allowed AS signal_real_funds_allowed,
           s.mainnet_allowed AS signal_mainnet_allowed,
           s.withdrawals_allowed AS signal_withdrawals_allowed,
           a.reservation_applied AS assessment_reservation_applied,
           a.automatically_submitted AS assessment_automatically_submitted,
           a.provider_mutation_allowed AS assessment_provider_mutation_allowed,
           a.execution_allowed AS assessment_execution_allowed,
           a.real_funds_allowed AS assessment_real_funds_allowed,
           a.mainnet_allowed AS assessment_mainnet_allowed,
           a.withdrawals_allowed AS assessment_withdrawals_allowed,
           f.provider_order_created,
           f.provider_fill_claimed,
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
     WHERE f.simulation_hash = ? OR f.assessment_binding_hash = ?
     LIMIT 1
  `).bind(simulationHash, assessmentBindingHash).first<StoredEvidenceRow>()
}

async function loadSignal(
  env: CertificationEvidenceStoreEnv,
  signalEvidenceHash: string,
  signalIdentityHash: string,
): Promise<StoredSignalRow | null> {
  return env.DB.prepare(`
    SELECT signal_evidence_hash, signal_identity_hash, evidence_json, provider_mutation_allowed,
           execution_allowed, real_funds_allowed, mainnet_allowed,
           withdrawals_allowed
      FROM live_certification_signal_evidence
     WHERE signal_evidence_hash = ? OR signal_identity_hash = ?
     LIMIT 1
  `).bind(signalEvidenceHash, signalIdentityHash).first<StoredSignalRow>()
}

function matches(
  row: StoredEvidenceRow,
  signalJson: string,
  assessmentJson: string,
  simulationJson: string,
  signal: CertificationSignalEvidence,
  assessment: CertificationSignalAssessment,
  simulation: CertificationFillSimulation,
): boolean {
  return row.signal_evidence_hash === signal.evidenceHash
    && row.assessment_binding_hash === assessment.assessmentBindingHash
    && row.simulation_hash === simulation.simulationHash
    && row.signal_json === signalJson
    && row.assessment_json === assessmentJson
    && row.simulation_json === simulationJson
}

function receipt(
  signal: CertificationSignalEvidence,
  assessment: CertificationSignalAssessment,
  simulation: CertificationFillSimulation,
  projectionStatus: CertificationEvidenceProjectionReceipt['projectionStatus'],
  persistedAt: string,
): CertificationEvidenceProjectionReceipt {
  return Object.freeze({
    signalEvidenceHash: signal.evidenceHash,
    assessmentBindingHash: assessment.assessmentBindingHash,
    simulationHash: simulation.simulationHash,
    projectionStatus,
    persistedAt,
    providerMutationAllowed: false,
    executionAllowed: false,
    realFundsAllowed: false,
    mainnetAllowed: false,
    withdrawalsAllowed: false,
  })
}

/**
 * Explicit projection boundary. It is intentionally not called by signal
 * evaluation or fill simulation and is not wired to a Worker route.
 */
export async function persistCertificationEvidence(
  env: CertificationEvidenceStoreEnv,
  signal: CertificationSignalEvidence,
  assessment: CertificationSignalAssessment,
  simulation: CertificationFillSimulation,
  persistedAt: string,
): Promise<CertificationEvidenceProjectionReceipt> {
  const persisted = timestamp(persistedAt, 'persistedAt')
  await verifyCertificationSignalEvidence(signal, persisted.milliseconds)
  assertCrossEvidence(signal, assessment, simulation)
  if (persisted.milliseconds < Date.parse(simulation.fill.sequenceTimestamp)) {
    throw new CertificationEvidenceStoreError('persistedAt cannot precede the simulated fill')
  }
  const signalJson = canonicalJson(signal)
  const assessmentJson = canonicalJson(assessment)
  const simulationJson = canonicalJson(simulation)

  const existing = await loadEvidence(
    env,
    simulation.simulationHash,
    assessment.assessmentBindingHash,
  )
  if (existing) {
    assertStoredLocks(existing)
    if (!matches(existing, signalJson, assessmentJson, simulationJson, signal, assessment, simulation)) {
      throw new CertificationEvidenceStoreError('stored certification evidence conflicts with current evidence')
    }
    return receipt(signal, assessment, simulation, 'REPLAYED', existing.persisted_at)
  }

  const existingSignal = await loadSignal(env, signal.evidenceHash, signal.signalIdentityHash)
  if (existingSignal) {
    if (
      existingSignal.signal_evidence_hash !== signal.evidenceHash
      || existingSignal.signal_identity_hash !== signal.signalIdentityHash
      || existingSignal.evidence_json !== signalJson
      || existingSignal.provider_mutation_allowed !== 0
      || existingSignal.execution_allowed !== 0
      || existingSignal.real_funds_allowed !== 0
      || existingSignal.mainnet_allowed !== 0
      || existingSignal.withdrawals_allowed !== 0
    ) {
      throw new CertificationEvidenceStoreError('stored certification signal conflicts with current evidence')
    }
  }

  try {
    const statements = []
    if (!existingSignal) {
      statements.push(env.DB.prepare(`
        INSERT INTO live_certification_signal_evidence (
          signal_evidence_hash, signal_identity_hash, source_hash, provider, product_symbol,
          direction, confidence_bps, reference_price, latest_closed_at_ms,
          evidence_json, requires_independent_risk_decision,
          provider_mutation_allowed, execution_allowed, real_funds_allowed,
          mainnet_allowed, withdrawals_allowed, created_at
        ) VALUES (?, ?, ?, 'BITGET', ?, ?, ?, ?, ?, ?, 1, 0, 0, 0, 0, 0, ?)
      `).bind(
        signal.evidenceHash,
        signal.signalIdentityHash,
        signal.sourceHash,
        signal.productSymbol,
        signal.direction,
        signal.confidenceBps,
        signal.referencePrice,
        signal.latestClosedAtMs,
        signalJson,
        persisted.iso,
      ))
    }
    statements.push(
      env.DB.prepare(`
        INSERT INTO live_certification_signal_assessments (
          assessment_binding_hash, signal_evidence_hash,
          candidate_assessment_hash, exchange_account_id, internal_order_id,
          product_id, side, status, evidence_json, reservation_applied,
          automatically_submitted, provider_mutation_allowed, execution_allowed,
          real_funds_allowed, mainnet_allowed, withdrawals_allowed, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'READY_BUT_EXECUTION_LOCKED', ?, 0, 0, 0, 0, 0, 0, 0, ?)
      `).bind(
        assessment.assessmentBindingHash,
        signal.evidenceHash,
        assessment.candidateAssessment.evidenceHash,
        assessment.exchangeAccountId,
        assessment.orderId,
        assessment.productId,
        assessment.side,
        assessmentJson,
        persisted.iso,
      ),
      env.DB.prepare(`
        INSERT INTO live_certification_fill_simulations (
          simulation_hash, assessment_binding_hash, signal_evidence_hash,
          fill_id, accounting_hash, product_id, side, fill_price, base_size,
          commission, simulated_at, evidence_json, provider_order_created,
          provider_fill_claimed, reservation_applied, automatically_persisted,
          provider_mutation_allowed, execution_allowed, real_funds_allowed,
          mainnet_allowed, withdrawals_allowed, persisted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, ?)
      `).bind(
        simulation.simulationHash,
        assessment.assessmentBindingHash,
        signal.evidenceHash,
        simulation.fill.fillId,
        simulation.accounting.accountingHash,
        simulation.fill.productId,
        simulation.fill.side,
        simulation.fill.price,
        simulation.fill.baseSize,
        simulation.fill.commission,
        simulation.fill.sequenceTimestamp,
        simulationJson,
        persisted.iso,
      ),
    )
    await env.DB.batch(statements)
  } catch {
    throw new CertificationEvidenceStoreError('immutable certification evidence batch was rejected')
  }

  const stored = await loadEvidence(
    env,
    simulation.simulationHash,
    assessment.assessmentBindingHash,
  )
  if (!stored) throw new CertificationEvidenceStoreError('certification evidence is missing after projection')
  assertStoredLocks(stored)
  if (!matches(stored, signalJson, assessmentJson, simulationJson, signal, assessment, simulation)) {
    throw new CertificationEvidenceStoreError('projected certification evidence failed verification')
  }
  return receipt(signal, assessment, simulation, 'PROJECTED', persisted.iso)
}
