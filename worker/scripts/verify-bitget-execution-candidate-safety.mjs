import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const failures = []
const candidate = read('worker/src/live/adapters/bitget/execution-candidate.ts')
const lockedCommand = read('worker/src/live/bitget-locked-order-command.ts')
const entrypoint = read('worker/src/index_live_candidate.ts')

function requireToken(content, token, message) {
  if (!content.includes(token)) failures.push(message)
}

for (const [token, message] of [
  ["method: 'POST_EVIDENCE_ONLY'", 'mutation candidate must be unsigned evidence only'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
  ['transportSelected: false', 'transport-selection lock is missing'],
  ['signingMaterialPresent: false', 'signing-material absence proof is missing'],
  ['evidenceBindings:', 'provider request evidence bindings are missing'],
  ['mandatory_read_only_recovery', 'mandatory read-only recovery warning is missing'],
  ['split_outcome_requires_both_identity_lookups', 'cancel-replace split-outcome recovery proof is missing'],
  ["throw new CandidateExecutionLockedError('bitget.submitPlaceOrder')", 'place submission must permanently throw'],
  ["throw new CandidateExecutionLockedError('bitget.submitCancelOrder')", 'cancel submission must permanently throw'],
  ["throw new CandidateExecutionLockedError('bitget.submitCancelReplaceOrder')", 'cancel-replace submission must permanently throw'],
]) {
  requireToken(candidate, token, message)
}

for (const [token, message] of [
  ['assessBitgetCandidateOrder', 'locked command must reuse the assessment pipeline'],
  ['previewHash: assessment.preview.rawResponseHash', 'locked command must bind the preview hash'],
  ['reservationJournalDraft', 'locked command must bind reservation evidence'],
  ['providerMutationAllowed: false', 'locked command provider mutation lock is missing'],
  ['executionAllowed: false', 'locked command execution lock is missing'],
  ['automaticRetryAllowed: false', 'locked command retry lock is missing'],
  ['automaticallySubmitted: false', 'locked command automatic submission lock is missing'],
]) {
  requireToken(lockedCommand, token, message)
}

const forbiddenPatterns = [
  /\bfetch\s*\(/,
  /Authorization\s*:/i,
  /ACCESS[-_]?KEY/i,
  /SECRET[-_]?KEY/i,
  /PASSPHRASE/i,
  /private[-_]?key/i,
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /automaticallySubmitted:\s*true/,
  /\bbody\.(?:previewHash|replacementCandidateHash)\s*=/,
  /unsignedBody:\s*Object\.freeze\(\{[^}]{0,500}(?:previewHash|replacementCandidateHash)/,
]

for (const pattern of forbiddenPatterns) {
  if (pattern.test(candidate) || pattern.test(lockedCommand)) {
    failures.push(`forbidden Bitget execution-candidate capability detected: ${pattern}`)
  }
}

for (const route of [
  '/bitget/place',
  '/bitget/cancel',
  '/bitget/cancel-replace',
  '/candidate/order/submit',
]) {
  if (entrypoint.includes(route)) failures.push(`public mutation route detected: ${route}`)
}

if (failures.length > 0) {
  console.error('Bitget execution-candidate safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget execution-candidate safety verification passed.')
