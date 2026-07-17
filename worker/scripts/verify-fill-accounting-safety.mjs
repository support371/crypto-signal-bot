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
const migration = read('worker/migrations/015_live_fill_accounting.sql')
const entrypoint = read('worker/src/index_live_candidate.ts')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ["export type CostBasisMethod = 'FIFO'", 'FIFO cost-basis method is missing'],
  ['divideDecimalDown', 'exact downward cost allocation is missing'],
  ['addSignedDecimal', 'signed cumulative realized PnL is missing'],
  ['InsufficientCostBasisError', 'insufficient FIFO basis must fail closed'],
  ['feeQuoteValue is required for third-asset commission', 'third-asset fee valuation guard is missing'],
  ["commissionAsset === input.baseAsset", 'base-asset fee quantity treatment is missing'],
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
  ["method TEXT NOT NULL CHECK (method = 'FIFO')", 'migration FIFO constraint is missing'],
  ['position_quantity TEXT NOT NULL', 'receipt position quantity is missing'],
  ['cumulative_realized_pnl_quote TEXT NOT NULL', 'receipt realized PnL is missing'],
  ['provider_mutation_allowed INTEGER NOT NULL DEFAULT 0', 'migration provider mutation lock is missing'],
  ['CHECK (provider_mutation_allowed = 0)', 'migration provider mutation zero constraint is missing'],
  ['CHECK (reservation_applied = 0)', 'migration reservation zero constraint is missing'],
  ['CHECK (execution_allowed = 0)', 'migration execution zero constraint is missing'],
  ['live_fill_accounting_receipts_no_update', 'receipt immutability trigger is missing'],
  ['live_cost_basis_lots_no_update', 'lot immutability trigger is missing'],
  ['live_cost_basis_consumptions_no_update', 'consumption immutability trigger is missing'],
  ['live_realized_pnl_events_no_update', 'realized PnL immutability trigger is missing'],
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
  if (engine.includes(forbidden) || store.includes(forbidden) || service.includes(forbidden)) {
    failures.push(`forbidden fill-accounting capability detected: ${forbidden}`)
  }
}

if (
  entrypoint.includes('/fill-accounting')
  || entrypoint.includes('/tax-lots')
  || entrypoint.includes('/realized-pnl')
) {
  failures.push('fill accounting must not be publicly exposed by the live candidate Worker')
}

if (failures.length > 0) {
  console.error('Fill accounting safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Fill accounting safety verification passed.')
