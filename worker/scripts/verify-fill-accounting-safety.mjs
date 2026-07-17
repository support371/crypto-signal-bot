import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const failures = []
const engine = read('worker/src/live/fill-accounting.ts')
const store = read('worker/src/live/fill-accounting-store.ts')
const service = read('worker/src/live/fill-accounting-service.ts')
const reconciliation = read('worker/src/live/fill-accounting-reconciliation.ts')
const reconciliationStore = read('worker/src/live/fill-accounting-reconciliation-store.ts')
const serialization = read('worker/src/live/fill-accounting-serialization.ts')
const coordinator = read('worker/src/live/observed-account-coordinator.ts')
const migration = read('worker/migrations/015_live_fill_accounting.sql')
const entrypoint = read('worker/src/index_live_candidate.ts')
const config = read('wrangler.live-candidate.toml')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ["export type CostBasisMethod = 'FIFO'", 'FIFO cost-basis method is missing'],
  ['divideDecimalDown', 'exact downward cost allocation is missing'],
  ['addSignedDecimal', 'signed cumulative realized PnL is missing'],
  ['InsufficientCostBasisError', 'insufficient FIFO basis must fail closed'],
  ['feeQuoteValue is required for third-asset commission', 'third-asset fee valuation guard is missing'],
  ['commissionAsset === baseAsset', 'base-asset fee quantity treatment is missing'],
  ['lot-consumption:', 'deterministic lot-consumption IDs are missing'],
  ['realized-pnl:', 'deterministic realized PnL IDs are missing'],
  ['markPositionToMarket', 'unrealized PnL mark-to-market function is missing'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing from accounting result'],
  ['reservationApplied: false', 'reservation apply lock is missing from accounting result'],
  ['executionAllowed: false', 'execution lock is missing from accounting result'],
]) {
  requireToken(engine, token, message)
}

for (const [token, message] of [
  ['persistSpotFillAccountingFifo', 'transactional FIFO accounting projector is missing'],
  ['loadOpenLots', 'immutable lot reconstruction is missing'],
  ['loadCumulativeRealizedPnl', 'cumulative realized PnL loading is missing'],
  ['assertExistingFillCompatible', 'existing fill conflict check is missing'],
  ['assertNoOrphanedJournal', 'orphaned journal conflict check is missing'],
  ['env.DB.batch(statements)', 'single D1 accounting batch is missing'],
  ['INSERT OR IGNORE INTO live_fills', 'idempotent fill projection is missing'],
  ['INSERT INTO ledger_journals', 'ledger journal persistence is missing'],
  ['INSERT INTO ledger_entries', 'ledger entry persistence is missing'],
  ['INSERT INTO live_cost_basis_lots', 'tax-lot persistence is missing'],
  ['INSERT INTO live_cost_basis_consumptions', 'lot-consumption persistence is missing'],
  ['INSERT INTO live_realized_pnl_events', 'realized PnL persistence is missing'],
  ['INSERT INTO live_position_accounting', 'position accounting persistence is missing'],
  ['INSERT INTO live_fill_accounting_receipts', 'immutable accounting receipt is missing'],
  ['position_quantity', 'exact replay position quantity is missing from receipt projection'],
  ['cumulative_realized_pnl_quote', 'exact replay realized PnL is missing from receipt projection'],
  ['providerMutationAllowed: false', 'projector provider mutation lock is missing'],
  ['reservationApplied: false', 'projector reservation lock is missing'],
  ['executionAllowed: false', 'projector execution lock is missing'],
]) {
  requireToken(store, token, message)
}

for (const [token, message] of [
  ['persistSpotFillAccountingVerified', 'verified accounting service boundary is missing'],
  ['normalizeExecutionExchange', 'canonical BTCC and Bitget provider validation is missing'],
  ['exchangeName: CanonicalExecutionExchange', 'verified result provider identity is missing'],
  ['assertNoOrphanedJournal', 'orphaned journal quarantine is missing'],
  ['orphaned fill-accounting journal exists without an immutable receipt', 'orphaned journal failure reason is missing'],
  ['verifiedReplayState', 'replay-state verification is missing'],
  ['replayed accounting result does not match the immutable receipt', 'immutable receipt replay comparison is missing'],
  ['provider_mutation_allowed', 'replay provider lock verification is missing'],
  ['reservation_applied', 'replay reservation lock verification is missing'],
  ['execution_allowed', 'replay execution lock verification is missing'],
  ['replayStateVerified: true', 'verified replay marker is missing'],
  ['providerMutationAllowed: false', 'verified service provider mutation lock is missing'],
  ['reservationApplied: false', 'verified service reservation lock is missing'],
  ['executionAllowed: false', 'verified service execution lock is missing'],
]) {
  requireToken(service, token, message)
}

for (const [token, message] of [
  ['reconcileFillAccounting', 'exact accounting reconciliation engine is missing'],
  ['calculateSignedLedgerBalance', 'signed ledger reconstruction is missing'],
  ["status: 'CLEAR' | 'HALT_FOR_REVIEW'", 'reconciliation halt status is missing'],
  ['lot_quantity_mismatch', 'lot quantity mismatch reason is missing'],
  ['lot_cost_basis_mismatch', 'lot cost-basis mismatch reason is missing'],
  ['realized_pnl_mismatch', 'realized PnL mismatch reason is missing'],
  ['average_entry_price_mismatch', 'average entry mismatch reason is missing'],
  ['ledger_inventory_negative', 'negative ledger inventory reason is missing'],
  ['ledger_position_quantity_mismatch', 'ledger-position mismatch reason is missing'],
  ['exchange_position_quantity_mismatch', 'exchange-position mismatch reason is missing'],
  ['current_price_not_positive', 'current price validation reason is missing'],
  ['providerMutationAllowed: false', 'reconciliation provider mutation lock is missing'],
  ['reservationApplied: false', 'reconciliation reservation lock is missing'],
  ['executionAllowed: false', 'reconciliation execution lock is missing'],
]) {
  requireToken(reconciliation, token, message)
}

for (const [token, message] of [
  ['persistFillAccountingReconciliation', 'reconciliation projector is missing'],
  ['normalizeExecutionExchange', 'reconciliation provider validation is missing'],
  ['loadPosition', 'reconciliation position loading is missing'],
  ['loadLots', 'reconciliation lot reconstruction is missing'],
  ['loadRealizedPnl', 'reconciliation realized PnL loading is missing'],
  ['loadLedgerBalance', 'reconciliation ledger loading is missing'],
  ['AND asset = ?', 'ledger reconciliation must be scoped to the base asset'],
  ['ledgerBaseAccountIds must contain 1-', 'ledger account scope bound is missing'],
  ['ledgerBaseAccountIds must be unique', 'ledger account uniqueness guard is missing'],
  ['reconstructed_average_entry_price', 'exact reconciliation average entry replay is missing'],
  ['assertReceiptLocks', 'reconciliation capability-lock verification is missing'],
  ['parseReasons', 'reconciliation reasons validation is missing'],
  ['fill-accounting reconciliation receipt verification failed', 'post-insert reconciliation verification is missing'],
  ['INSERT INTO live_fill_accounting_reconciliations', 'immutable reconciliation insert is missing'],
  ['providerMutationAllowed: false', 'reconciliation store provider mutation lock is missing'],
  ['reservationApplied: false', 'reconciliation store reservation lock is missing'],
  ['executionAllowed: false', 'reconciliation store execution lock is missing'],
]) {
  requireToken(reconciliationStore, token, message)
}

for (const [token, message] of [
  ['export class FillAccountingSerialQueue', 'per-account accounting queue is missing'],
  ['private tail: Promise<void>', 'accounting queue tail is missing'],
  ['await previous', 'accounting operations are not serialized'],
  ['release()', 'accounting queue release is missing'],
]) {
  requireToken(serialization, token, message)
}

for (const [token, message] of [
  ["ACCOUNTING_ROUTE = '/candidate/fills/account'", 'internal accounting route is missing'],
  ["RECONCILIATION_ROUTE = '/candidate/fills/reconcile'", 'internal reconciliation route is missing'],
  ['CANDIDATE_ACCOUNTING_TOKEN', 'separate accounting authentication secret is missing'],
  ["ACCOUNTING_TOKEN_HEADER = 'X-Candidate-Accounting-Token'", 'accounting token header is missing'],
  ['constantTimeEqual', 'constant-time accounting token comparison is missing'],
  ['MAX_ACCOUNTING_REQUEST_BYTES = 512 * 1024', 'bounded accounting request size is missing'],
  ['FillAccountingSerialQueue', 'coordinator accounting queue integration is missing'],
  ['this.accountingQueue.run', 'accounting services are not serialized'],
  ['persistSpotFillAccountingVerified', 'verified accounting service is not used by coordinator'],
  ['persistFillAccountingReconciliation', 'reconciliation projector is not used by coordinator'],
  ['handleReconciliation', 'serialized reconciliation handler is missing'],
  ["serializedBy: 'EXCHANGE_ACCOUNT_COORDINATOR'", 'serialized accounting response marker is missing'],
  ['providerMutationAllowed: false', 'coordinator provider mutation lock is missing'],
  ['reservationApplied: false', 'coordinator reservation lock is missing'],
  ['executionAllowed: false', 'coordinator execution lock is missing'],
]) {
  requireToken(coordinator, token, message)
}

for (const [token, message] of [
  ["method TEXT NOT NULL CHECK (method = 'FIFO')", 'migration FIFO constraint is missing'],
  ['position_quantity TEXT NOT NULL', 'receipt position quantity is missing'],
  ['cumulative_realized_pnl_quote TEXT NOT NULL', 'receipt realized PnL is missing'],
  ['CREATE TABLE IF NOT EXISTS live_fill_accounting_reconciliations', 'reconciliation evidence table is missing'],
  ["status TEXT NOT NULL CHECK (status IN ('CLEAR', 'HALT_FOR_REVIEW'))", 'reconciliation status constraint is missing'],
  ['input_hash TEXT NOT NULL CHECK (length(input_hash) = 64)', 'reconciliation input hash is missing'],
  ['ledger_account_ids_json TEXT NOT NULL', 'reconciliation ledger account scope is missing'],
  ['reconstructed_average_entry_price TEXT', 'reconciliation average entry evidence is missing'],
  ['provider_mutation_allowed INTEGER NOT NULL DEFAULT 0', 'migration provider mutation lock is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'migration provider mutation zero constraint is missing'],
  ['CHECK (reservation_applied = 0)', 'migration reservation zero constraint is missing'],
  ['CHECK (execution_allowed = 0)', 'migration execution zero constraint is missing'],
  ['live_fill_accounting_receipts_no_update', 'receipt immutability trigger is missing'],
  ['live_cost_basis_lots_no_update', 'lot immutability trigger is missing'],
  ['live_cost_basis_consumptions_no_update', 'consumption immutability trigger is missing'],
  ['live_realized_pnl_events_no_update', 'realized PnL immutability trigger is missing'],
  ['live_fill_accounting_reconciliations_no_update', 'reconciliation immutability trigger is missing'],
  ['live_fill_accounting_reconciliations_no_delete', 'reconciliation delete guard is missing'],
]) {
  requireToken(migration, token, message)
}

for (const forbidden of [
  'createOrder',
  'cancelOrder',
  'replaceOrder',
  'requestWithdrawal',
  'providerMutationAllowed: true',
  'reservationApplied: true',
  'executionAllowed: true',
]) {
  if (
    engine.includes(forbidden)
    || store.includes(forbidden)
    || service.includes(forbidden)
    || reconciliation.includes(forbidden)
    || reconciliationStore.includes(forbidden)
    || serialization.includes(forbidden)
    || coordinator.includes(forbidden)
  ) {
    failures.push(`forbidden fill-accounting capability detected: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/fill-accounting')
  || entrypoint.includes('/tax-lots')
  || entrypoint.includes('/realized-pnl')
  || entrypoint.includes('/candidate/fills/account')
  || entrypoint.includes('/candidate/fills/reconcile')
) {
  failures.push('fill accounting and reconciliation must not be publicly exposed')
}

if (/CANDIDATE_ACCOUNTING_TOKEN\s*=/.test(config)) {
  failures.push('candidate accounting secret must not be provisioned in source configuration')
}

if (failures.length > 0) {
  console.error('Fill accounting safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Fill accounting safety verification passed.')
