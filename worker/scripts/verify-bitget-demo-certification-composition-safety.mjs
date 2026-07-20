import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const sourcePath = 'worker/src/live/adapters/bitget/demo-certification-composition.ts'
const source = fs.readFileSync(path.join(repoRoot, sourcePath), 'utf8')
const packageJson = fs.readFileSync(path.join(repoRoot, 'worker/package.json'), 'utf8')
const failures = []

for (const [token, message] of [
  ['runComposedBitgetDemoPlaceCertification', 'source-only composition function is missing'],
  ["input.candidate.operation !== 'PLACE'", 'composition must remain place-only'],
  ['assertDependencies(dependencies)', 'injected dependency verification is missing'],
  ['loadReviewedBitgetDemoDispatchAuthorization(', 'reviewed authorization must be reloaded first'],
  ['recordBitgetDemoPlaceControlBinding(', 'migration-027 control binding must be recorded or replayed'],
  ['createD1BitgetDemoFreshControlSource(env)', 'D1 fresh-control source is missing'],
  ['createVerifiedBitgetDemoFreshControlLoader(', 'fresh controls must use the private-brand verifier'],
  ['createBitgetDemoCallbackCredentialProvider(', 'callback-scoped credential adapter is missing'],
  ['createBitgetDemoDurableRateLimitAuthorityProvider(', 'account rate authority provider is missing'],
  ['createBitgetDemoGetOnlyRecoveryBoundary(', 'GET-only recovery boundary is missing'],
  ['runReviewedBitgetDemoCertification(', 'reviewed one-shot certification runner is missing'],
  ['fetcher: dependencies.fetcher', 'demo fetcher must be injected'],
  ['clock: dependencies.clock', 'trusted clock must be injected'],
  ['sourceOnly: true', 'source-only evidence is missing'],
  ['demoCertificationOnly: true', 'demo-only evidence is missing'],
  ['providerMutationAllowed: false', 'provider mutation lock is missing'],
  ['executionAllowed: false', 'execution lock is missing'],
  ['liveExecutionAllowed: false', 'live execution lock is missing'],
  ['realFundsAllowed: false', 'real-funds lock is missing'],
  ['mainnetAllowed: false', 'mainnet lock is missing'],
  ['withdrawalsAllowed: false', 'withdrawal lock is missing'],
  ['automaticRetryAllowed: false', 'automatic retry lock is missing'],
  ['accountingAutomaticallyDispatched: false', 'automatic accounting lock is missing'],
]) {
  if (!source.includes(token)) failures.push(message)
}

const reviewedPosition = source.lastIndexOf('loadReviewedBitgetDemoDispatchAuthorization(')
const bindingPosition = source.lastIndexOf('recordBitgetDemoPlaceControlBinding(')
const freshPosition = source.lastIndexOf('createD1BitgetDemoFreshControlSource(env)')
const credentialPosition = source.lastIndexOf('createBitgetDemoCallbackCredentialProvider(')
const ratePosition = source.lastIndexOf('createBitgetDemoDurableRateLimitAuthorityProvider(')
const recoveryPosition = source.lastIndexOf('createBitgetDemoGetOnlyRecoveryBoundary(')
const runnerPosition = source.lastIndexOf('runReviewedBitgetDemoCertification(')
if (
  reviewedPosition < 0
  || bindingPosition < 0
  || freshPosition < 0
  || credentialPosition < 0
  || ratePosition < 0
  || recoveryPosition < 0
  || runnerPosition < 0
  || reviewedPosition >= bindingPosition
  || bindingPosition >= freshPosition
  || freshPosition >= runnerPosition
  || credentialPosition >= runnerPosition
  || ratePosition >= runnerPosition
  || recoveryPosition >= runnerPosition
) {
  failures.push('composition ordering is not authorization -> binding -> adapters -> runner')
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /SecretsStore/i,
  /globalThis\.fetch/,
  /\?\?\s*fetch\b/,
  /\bfetch\.bind\s*\(/,
  /\bconsole\./,
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(/,
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /liveExecutionAllowed:\s*true/,
  /realFundsAllowed:\s*true/,
  /mainnetAllowed:\s*true/,
  /withdrawalsAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /accountingAutomaticallyDispatched:\s*true/,
]) {
  if (pattern.test(source)) {
    failures.push(`forbidden demo composition capability detected: ${pattern}`)
  }
}

for (const entrypoint of [
  'worker/src/index.ts',
  'worker/src/index_live_candidate.ts',
  'worker/src/index_withdrawals_candidate.ts',
  'worker/src/index_bitget_trade_quarantine.ts',
]) {
  const absolute = path.join(repoRoot, entrypoint)
  if (fs.existsSync(absolute) && /demo-certification-composition/.test(fs.readFileSync(absolute, 'utf8'))) {
    failures.push(`${entrypoint} must not import the source-only demo composition`)
  }
}

for (const configPath of [
  'wrangler.toml',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
  'wrangler.bitget-trade-quarantine.toml',
]) {
  const config = fs.readFileSync(path.join(repoRoot, configPath), 'utf8')
  if (/demo-certification-composition|BITGET_DEMO_COMPOSITION/i.test(config)) {
    failures.push(`${configPath} must not bind or configure the source-only demo composition`)
  }
}

if (!packageJson.includes('live-bitget-demo-certification-composition.test.ts')) {
  failures.push('composition tests are not wired into provider validation')
}
if (!packageJson.includes('verify-bitget-demo-certification-composition-safety.mjs')) {
  failures.push('composition verifier is not wired into the Worker safety chain')
}

if (failures.length > 0) {
  console.error('Bitget demo certification-composition safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget demo certification-composition safety verification passed.')
