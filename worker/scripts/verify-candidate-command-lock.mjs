import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const commandPlan = fs.readFileSync(
  path.join(repoRoot, 'worker/src/live/candidate-command-plan.ts'),
  'utf8',
)
const preview = fs.readFileSync(
  path.join(repoRoot, 'worker/src/live/adapters/bitget/preview.ts'),
  'utf8',
)

const failures = []

function requirePattern(content, pattern, message) {
  if (!pattern.test(content)) failures.push(message)
}

requirePattern(
  commandPlan,
  /executionUnlocked:\s*false/,
  'candidate risk input must force executionUnlocked=false',
)
requirePattern(
  commandPlan,
  /executionAllowed:\s*false/,
  'candidate assessment must always report executionAllowed=false',
)
requirePattern(
  commandPlan,
  /READY_BUT_EXECUTION_LOCKED/,
  'candidate ready status must remain explicitly execution-locked',
)
requirePattern(
  commandPlan,
  /buildReservationJournal/,
  'candidate assessment must produce only a balanced reservation draft',
)
requirePattern(
  commandPlan,
  /reservationJournalDraft/,
  'candidate assessment reservation output is missing',
)
requirePattern(
  commandPlan,
  /reasons\.add\('execution_locked'\)/,
  'candidate assessment must always include execution_locked evidence',
)
requirePattern(
  preview,
  /CandidateExecutionLockedError\('bitget\.createOrder'\)/,
  'Bitget preview adapter create-order lock is missing',
)

for (const forbidden of [
  /BitgetReadOnlyClient/,
  /\.createOrder\(/,
  /\.cancelOrder\(/,
  /\.replaceOrder\(/,
  /fetch\(/,
  /DB\.prepare/,
  /\.run\(\)/,
]) {
  if (forbidden.test(commandPlan)) {
    failures.push(`candidate command plan contains forbidden dependency or mutation: ${forbidden}`)
  }
}

if (failures.length > 0) {
  console.error('Candidate command-lock verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Candidate command-lock verification passed.')
