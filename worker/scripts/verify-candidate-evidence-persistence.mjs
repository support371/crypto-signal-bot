import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

function requirePattern(content, pattern, message, failures) {
  if (!pattern.test(content)) failures.push(message)
}

const failures = []
const coordinator = read('worker/src/live/account-coordinator.ts')
const evidence = read('worker/src/live/candidate-evidence.ts')
const migration = read('worker/migrations/014_live_candidate_assessment_evidence.sql')
const entrypoint = read('worker/src/index_live_candidate.ts')

requirePattern(coordinator, /transactionSync\(\(\) => \{/, 'coordinator atomic SQLite transaction is missing', failures)
requirePattern(coordinator, /candidate_assessment_commits/, 'authoritative assessment commit table is missing', failures)
requirePattern(coordinator, /candidate_reservation_drafts/, 'authoritative reservation draft table is missing', failures)
requirePattern(coordinator, /candidate_projection_outbox/, 'durable projection outbox is missing', failures)
requirePattern(coordinator, /execution_allowed[\s\S]*CHECK \(execution_allowed = 0\)/, 'coordinator execution lock constraint is missing', failures)
requirePattern(coordinator, /applied[\s\S]*CHECK \(applied = 0\)/, 'coordinator reservation draft apply lock is missing', failures)
requirePattern(coordinator, /CANDIDATE_EVIDENCE_TOKEN/, 'internal evidence authentication is missing', failures)
requirePattern(coordinator, /constantTimeEqual/, 'constant-time internal token comparison is missing', failures)
requirePattern(coordinator, /projectCandidateEvidenceToD1\(this\.env\.DB, committed\.envelope\)/, 'D1 outbox projection call is missing', failures)
requirePattern(coordinator, /projectionStatus !== 'PROJECTED'/, 'projection retry guard is missing', failures)
requirePattern(coordinator, /LIVE_CANDIDATE_EXECUTION_LOCKED/, 'coordinator hard execution lock is missing', failures)
requirePattern(coordinator, /orderSubmissionEnabled:\s*false/, 'coordinator order submission must remain disabled', failures)
requirePattern(coordinator, /cancellationEnabled:\s*false/, 'coordinator cancellation must remain disabled', failures)
requirePattern(coordinator, /withdrawalsEnabled:\s*false/, 'coordinator withdrawals must remain disabled', failures)

requirePattern(evidence, /db\.batch\(statements\)/, 'D1 transactional batch projection is missing', failures)
requirePattern(evidence, /INSERT OR IGNORE INTO live_candidate_assessments/, 'idempotent assessment projection is missing', failures)
requirePattern(evidence, /INSERT OR IGNORE INTO live_candidate_reservation_drafts/, 'idempotent reservation projection is missing', failures)
requirePattern(evidence, /INSERT OR IGNORE INTO live_candidate_projection_receipts/, 'idempotent projection receipt is missing', failures)
requirePattern(evidence, /CandidateEvidenceConflictError/, 'projection conflict detection is missing', failures)
requirePattern(evidence, /executionAllowed:\s*false/, 'evidence envelope must remain execution-locked', failures)

requirePattern(migration, /execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK \(execution_allowed = 0\)/, 'D1 execution lock constraint is missing', failures)
requirePattern(migration, /applied INTEGER NOT NULL DEFAULT 0 CHECK \(applied = 0\)/, 'D1 reservation apply lock constraint is missing', failures)
requirePattern(migration, /live_candidate_assessments_no_update/, 'assessment immutability trigger is missing', failures)
requirePattern(migration, /live_candidate_reservation_drafts_no_update/, 'reservation draft immutability trigger is missing', failures)
requirePattern(migration, /live_candidate_projection_receipts_no_update/, 'projection receipt immutability trigger is missing', failures)

requirePattern(entrypoint, /pathname\.startsWith\('\/v1\/live\/coordinator'\)/, 'public Worker must hide coordinator routes', failures)
if (entrypoint.includes('/candidate/assessments')) {
  failures.push('candidate assessment persistence must not be exposed by the public Worker')
}

for (const forbidden of [
  /api\/v2\/spot\/trade\/place-order/,
  /api\/v2\/spot\/trade\/cancel-order/,
  /api\/v2\/spot\/wallet\/withdrawal/,
  /LIVE_EXECUTION_ENABLED\s*=\s*['"]true['"]/,
  /executionAllowed:\s*true/,
]) {
  if (coordinator.match(forbidden) || evidence.match(forbidden) || migration.match(forbidden)) {
    failures.push(`forbidden execution capability detected: ${forbidden}`)
  }
}

if (failures.length > 0) {
  console.error('Candidate evidence persistence verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Candidate evidence persistence verification passed.')
