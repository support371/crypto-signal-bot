export interface OperatorReadModelEnv {
  DB: D1Database
}

type CertificationRunRow = {
  run_id: string
  exchange_account_id: string
  product_id: string
  status: 'PASSED' | 'FAILED' | 'BLOCKED'
  read_only_evidence_complete: number
  permissions_verified: number
  product_count: number
  balance_count: number
  current_order_count: number
  history_order_count: number
  fill_count: number
  duplicate_order_count: number
  duplicate_fill_count: number
  evaluated_at: string
  evidence_hash: string
  certified_for_live: number
  provider_mutation_allowed: number
  execution_allowed: number
}

type CertificationCheckRow = {
  check_name: string
  status: 'PASS' | 'FAIL' | 'BLOCKED'
  reason: string | null
  evidence_hash: string
}

type AttestationRow = {
  attestation_id: string
  source_mode: 'INJECTED_FIXTURES' | 'ISOLATED_READ_ONLY_CLIENT'
  environment: 'LOCAL_TEST' | 'SHADOW' | 'TESTNET' | 'LIVE_CANDIDATE'
  source_ref: string
  operator_actor_id: string | null
  attested_at: string
  attestation_hash: string
  external_read_only_evidence: number
  certification_check_projection_allowed: number
  certified_for_live: number
  provider_mutation_allowed: number
  execution_allowed: number
}

type ReadinessRow = {
  checkpoint_id: string
  binding_id: string
  attestation_id: string
  ingestion_id: string
  exchange_account_id: string
  product_id: string
  source_mode: 'INJECTED_FIXTURES' | 'ISOLATED_READ_ONLY_CLIENT'
  external_read_only_evidence: number
  status: string
  reasons_json: string
  accounting_task_count: number
  accounting_receipt_count: number
  reservation_required_count: number
  settlement_receipt_count: number
  dispatch_status: string
  reconciliation_status: string
  latest_accounted_at: string | null
  latest_settled_at: string | null
  latest_reconciled_at: string | null
  oldest_task_at: string | null
  evaluated_at: string
  checkpoint_hash: string
  incident_required: number
  operator_review_required: number
  provider_mutation_allowed: number
  execution_allowed: number
}

type ReconciliationRow = {
  reconciliation_id: string
  exchange_name: string
  exchange_account_id: string
  product_id: string
  status: 'CLEAR' | 'HALT_FOR_REVIEW'
  reasons_json: string
  position_quantity: string
  reconstructed_quantity: string
  position_cost_basis_quote: string
  reconstructed_cost_basis_quote: string
  position_realized_pnl_quote: string
  reconstructed_realized_pnl_quote: string
  ledger_base_inventory_balance: string
  exchange_base_balance: string | null
  reconciliation_hash: string
  observed_at: string
  provider_mutation_allowed: number
  execution_allowed: number
}

type AlertRow = {
  alert_id: string
  exchange_account_id: string | null
  alert_key: string
  severity: 'INFO' | 'WARNING' | 'CRITICAL'
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPPRESSED'
  reason_code: string
  summary: string
  first_observed_at: string
  last_observed_at: string
  acknowledged_at: string | null
  occurrence_count: number
}

type AuditHeadRow = {
  sequence_id: number
  event_id: string
  exchange_account_id: string
  actor_id: string | null
  actor_role: string | null
  action: string
  resource_type: string
  resource_id: string
  configuration_version: string
  release_id: string | null
  outcome: string
  previous_event_hash: string
  event_hash: string
  occurred_at: string
}

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} is required`)
  return normalized
}

function optionalProduct(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toUpperCase()
  return normalized || null
}

function parseReasons(value: string): readonly string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return Object.freeze(['invalid_reasons_evidence'])
    return Object.freeze(parsed.map((reason) => String(reason)).filter(Boolean))
  } catch {
    return Object.freeze(['invalid_reasons_evidence'])
  }
}

function locked(value: number): boolean {
  return value === 0
}

export async function readLatestBitgetCertification(
  env: OperatorReadModelEnv,
  exchangeAccountId: string,
  productId?: string | null,
): Promise<unknown | null> {
  const accountId = required(exchangeAccountId, 'exchangeAccountId')
  const product = optionalProduct(productId)
  const run = await env.DB.prepare(`
    SELECT run_id, exchange_account_id, product_id, status,
           read_only_evidence_complete, permissions_verified,
           product_count, balance_count, current_order_count,
           history_order_count, fill_count, duplicate_order_count,
           duplicate_fill_count, evaluated_at, evidence_hash,
           certified_for_live, provider_mutation_allowed, execution_allowed
      FROM live_bitget_read_only_certification_runs
     WHERE exchange_account_id = ?
       AND (? IS NULL OR product_id = ?)
     ORDER BY evaluated_at DESC, run_id DESC
     LIMIT 1
  `).bind(accountId, product, product).first<CertificationRunRow>()
  if (!run) return null

  const checks = await env.DB.prepare(`
    SELECT check_name, status, reason, evidence_hash
      FROM live_bitget_read_only_certification_checks
     WHERE run_id = ?
     ORDER BY check_name ASC
  `).bind(run.run_id).all<CertificationCheckRow>()

  const attestation = await env.DB.prepare(`
    SELECT attestation_id, source_mode, environment, source_ref,
           operator_actor_id, attested_at, attestation_hash,
           external_read_only_evidence, certification_check_projection_allowed,
           certified_for_live, provider_mutation_allowed, execution_allowed
      FROM live_bitget_read_only_certification_attestations
     WHERE run_id = ?
     ORDER BY attested_at DESC, attestation_id DESC
     LIMIT 1
  `).bind(run.run_id).first<AttestationRow>()

  return Object.freeze({
    runId: run.run_id,
    provider: 'BITGET',
    exchangeAccountId: run.exchange_account_id,
    productId: run.product_id,
    status: run.status,
    readOnlyEvidenceComplete: run.read_only_evidence_complete === 1,
    permissionsVerified: run.permissions_verified === 1,
    counts: Object.freeze({
      products: run.product_count,
      balances: run.balance_count,
      currentOrders: run.current_order_count,
      historicalOrders: run.history_order_count,
      fills: run.fill_count,
      duplicateOrders: run.duplicate_order_count,
      duplicateFills: run.duplicate_fill_count,
    }),
    evaluatedAt: run.evaluated_at,
    evidenceHash: run.evidence_hash,
    checks: Object.freeze((checks.results ?? []).map((check) => Object.freeze({
      name: check.check_name,
      status: check.status,
      reason: check.reason,
      evidenceHash: check.evidence_hash,
    }))),
    attestation: attestation ? Object.freeze({
      attestationId: attestation.attestation_id,
      sourceMode: attestation.source_mode,
      environment: attestation.environment,
      sourceRef: attestation.source_ref,
      operatorActorId: attestation.operator_actor_id,
      attestedAt: attestation.attested_at,
      attestationHash: attestation.attestation_hash,
      externalReadOnlyEvidence: attestation.external_read_only_evidence === 1,
      certificationProjectionAllowed: attestation.certification_check_projection_allowed === 1,
    }) : null,
    certifiedForLive: run.certified_for_live === 1 || Boolean(attestation?.certified_for_live),
    providerMutationAllowed: !locked(run.provider_mutation_allowed)
      || Boolean(attestation && !locked(attestation.provider_mutation_allowed)),
    executionAllowed: !locked(run.execution_allowed)
      || Boolean(attestation && !locked(attestation.execution_allowed)),
  })
}

export async function readLatestAttestedRecoveryReadiness(
  env: OperatorReadModelEnv,
  exchangeAccountId: string,
  productId?: string | null,
): Promise<unknown | null> {
  const accountId = required(exchangeAccountId, 'exchangeAccountId')
  const product = optionalProduct(productId)
  const row = await env.DB.prepare(`
    SELECT checkpoint_id, binding_id, attestation_id, ingestion_id,
           exchange_account_id, product_id, source_mode,
           external_read_only_evidence, status, reasons_json,
           accounting_task_count, accounting_receipt_count,
           reservation_required_count, settlement_receipt_count,
           dispatch_status, reconciliation_status, latest_accounted_at,
           latest_settled_at, latest_reconciled_at, oldest_task_at,
           evaluated_at, checkpoint_hash, incident_required,
           operator_review_required, provider_mutation_allowed,
           execution_allowed
      FROM live_bitget_attested_recovery_readiness
     WHERE exchange_account_id = ?
       AND (? IS NULL OR product_id = ?)
     ORDER BY evaluated_at DESC, checkpoint_id DESC
     LIMIT 1
  `).bind(accountId, product, product).first<ReadinessRow>()
  if (!row) return null

  return Object.freeze({
    checkpointId: row.checkpoint_id,
    bindingId: row.binding_id,
    attestationId: row.attestation_id,
    ingestionId: row.ingestion_id,
    exchangeAccountId: row.exchange_account_id,
    productId: row.product_id,
    sourceMode: row.source_mode,
    externalReadOnlyEvidence: row.external_read_only_evidence === 1,
    status: row.status,
    reasons: parseReasons(row.reasons_json),
    counts: Object.freeze({
      accountingTasks: row.accounting_task_count,
      accountingReceipts: row.accounting_receipt_count,
      reservationRequired: row.reservation_required_count,
      settlementReceipts: row.settlement_receipt_count,
    }),
    dispatchStatus: row.dispatch_status,
    reconciliationStatus: row.reconciliation_status,
    latestAccountedAt: row.latest_accounted_at,
    latestSettledAt: row.latest_settled_at,
    latestReconciledAt: row.latest_reconciled_at,
    oldestTaskAt: row.oldest_task_at,
    evaluatedAt: row.evaluated_at,
    checkpointHash: row.checkpoint_hash,
    incidentRequired: row.incident_required === 1,
    operatorReviewRequired: row.operator_review_required === 1,
    providerMutationAllowed: row.provider_mutation_allowed === 1,
    executionAllowed: row.execution_allowed === 1,
  })
}

export async function readLatestFillReconciliation(
  env: OperatorReadModelEnv,
  exchangeAccountId: string,
  productId?: string | null,
): Promise<unknown | null> {
  const accountId = required(exchangeAccountId, 'exchangeAccountId')
  const product = optionalProduct(productId)
  const row = await env.DB.prepare(`
    SELECT reconciliation_id, exchange_name, exchange_account_id, product_id,
           status, reasons_json, position_quantity, reconstructed_quantity,
           position_cost_basis_quote, reconstructed_cost_basis_quote,
           position_realized_pnl_quote, reconstructed_realized_pnl_quote,
           ledger_base_inventory_balance, exchange_base_balance,
           reconciliation_hash, observed_at, provider_mutation_allowed,
           execution_allowed
      FROM live_fill_accounting_reconciliations
     WHERE exchange_account_id = ?
       AND (? IS NULL OR product_id = ?)
     ORDER BY observed_at DESC, reconciliation_id DESC
     LIMIT 1
  `).bind(accountId, product, product).first<ReconciliationRow>()
  if (!row) return null

  return Object.freeze({
    reconciliationId: row.reconciliation_id,
    exchange: row.exchange_name,
    exchangeAccountId: row.exchange_account_id,
    productId: row.product_id,
    status: row.status,
    reasons: parseReasons(row.reasons_json),
    quantities: Object.freeze({
      position: row.position_quantity,
      reconstructed: row.reconstructed_quantity,
      ledgerInventory: row.ledger_base_inventory_balance,
      exchangeBalance: row.exchange_base_balance,
    }),
    costBasisQuote: Object.freeze({
      position: row.position_cost_basis_quote,
      reconstructed: row.reconstructed_cost_basis_quote,
    }),
    realizedPnlQuote: Object.freeze({
      position: row.position_realized_pnl_quote,
      reconstructed: row.reconstructed_realized_pnl_quote,
    }),
    reconciliationHash: row.reconciliation_hash,
    observedAt: row.observed_at,
    providerMutationAllowed: row.provider_mutation_allowed === 1,
    executionAllowed: row.execution_allowed === 1,
  })
}

export async function readActiveAlerts(
  env: OperatorReadModelEnv,
  exchangeAccountId: string,
  limit = 50,
): Promise<readonly unknown[]> {
  const accountId = required(exchangeAccountId, 'exchangeAccountId')
  const boundedLimit = Math.min(50, Math.max(1, Math.trunc(limit)))
  const result = await env.DB.prepare(`
    SELECT alert_id, exchange_account_id, alert_key, severity, status,
           reason_code, summary, first_observed_at, last_observed_at,
           acknowledged_at, occurrence_count
      FROM live_alerts
     WHERE (exchange_account_id = ? OR exchange_account_id IS NULL)
       AND status IN ('OPEN', 'ACKNOWLEDGED')
     ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END,
              last_observed_at DESC, alert_id ASC
     LIMIT ?
  `).bind(accountId, boundedLimit).all<AlertRow>()

  return Object.freeze((result.results ?? []).map((row) => Object.freeze({
    alertId: row.alert_id,
    exchangeAccountId: row.exchange_account_id,
    alertKey: row.alert_key,
    severity: row.severity,
    status: row.status,
    reasonCode: row.reason_code,
    summary: row.summary,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    acknowledgedAt: row.acknowledged_at,
    occurrenceCount: row.occurrence_count,
  })))
}

export async function readAuditHead(
  env: OperatorReadModelEnv,
  exchangeAccountId: string,
): Promise<unknown | null> {
  const accountId = required(exchangeAccountId, 'exchangeAccountId')
  const row = await env.DB.prepare(`
    SELECT sequence_id, event_id, exchange_account_id, actor_id, actor_role,
           action, resource_type, resource_id, configuration_version,
           release_id, outcome, previous_event_hash, event_hash, occurred_at
      FROM immutable_audit_events
     WHERE exchange_account_id = ?
     ORDER BY sequence_id DESC
     LIMIT 1
  `).bind(accountId).first<AuditHeadRow>()
  if (!row) return null

  return Object.freeze({
    sequenceId: row.sequence_id,
    eventId: row.event_id,
    exchangeAccountId: row.exchange_account_id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    configurationVersion: row.configuration_version,
    releaseId: row.release_id,
    outcome: row.outcome,
    previousEventHash: row.previous_event_hash,
    eventHash: row.event_hash,
    occurredAt: row.occurred_at,
  })
}
