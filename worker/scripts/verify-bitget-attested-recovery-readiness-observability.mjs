import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'src/live/bitget-attested-recovery-readiness-observability.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const requiredTokens = [
  'projectBitgetAttestedRecoveryReadinessObservability',
  'recordMetricSample',
  'openOrRefreshAlert',
  'resolveAlert',
  'bitget_attested_recovery_readiness_status',
  'BITGET_ATTESTED_RECOVERY_HALTED',
  'BITGET_ATTESTED_RECOVERY_BACKLOG_STALE',
  'BITGET_ATTESTED_RECOVERY_CLEAR',
  "guardianAction: halted ? 'HALT_ACCOUNT' : 'RESTRICT_ACCOUNT'",
  'guardianMutationAllowed: false',
  'automaticAccountingDispatchAllowed: false',
  'automaticReservationSettlementAllowed: false',
  'automaticReconciliationAllowed: false',
  'providerMutationAllowed: false',
  'automaticRetryAllowed: false',
  'executionAllowed: false',
  'readiness checkpoint hash is invalid',
  'readiness checkpoint violates permanent capability locks',
]

for (const token of requiredTokens) {
  if (!source.includes(token)) throw new Error(`readiness observability missing required token: ${token}`)
}

const forbiddenPatterns = [
  /\bfetch\s*\(/,
  /ACCESS-KEY/i,
  /secretKey/i,
  /passphrase/i,
  /signBitget/i,
  /submit(?:Order|Candidate)/i,
  /createOrder\s*\(/,
  /cancelOrder\s*\(/,
  /replaceOrder\s*\(/,
  /dispatchApprovedRecoveryAccounting/i,
  /persistVerifiedFillAccounting\s*\(/,
  /persistReservationSettlement\s*\(/,
  /evaluateAndPersistBitgetAttestedRecoveryReadiness\s*\(/,
  /setGuardian/i,
  /resetGuardian/i,
  /guardianMutationAllowed:\s*true/,
  /automaticAccountingDispatchAllowed:\s*true/,
  /automaticReservationSettlementAllowed:\s*true/,
  /automaticReconciliationAllowed:\s*true/,
  /providerMutationAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /app\.(?:post|put|patch|delete)\s*\(/,
]

for (const pattern of forbiddenPatterns) {
  if (pattern.test(source)) throw new Error(`readiness observability contains forbidden pattern: ${pattern}`)
}

console.log('Bitget attested recovery readiness observability safety verified.')
