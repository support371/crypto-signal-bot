import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const candleClient = await readFile(
  new URL('../src/certification/bitget-public-candles.ts', import.meta.url),
  'utf8',
)
const signalEngine = await readFile(
  new URL('../src/certification/signal-engine.ts', import.meta.url),
  'utf8',
)
const assessmentBridge = await readFile(
  new URL('../src/certification/signal-assessment-bridge.ts', import.meta.url),
  'utf8',
)
const fillSimulation = await readFile(
  new URL('../src/certification/fill-simulation.ts', import.meta.url),
  'utf8',
)
const evidenceStore = await readFile(
  new URL('../src/certification/evidence-store.ts', import.meta.url),
  'utf8',
)
const simulationRunner = await readFile(
  new URL('../src/certification/simulation-runner.ts', import.meta.url),
  'utf8',
)
const readModel = await readFile(
  new URL('../src/certification/read-model.ts', import.meta.url),
  'utf8',
)
const stateLoader = await readFile(
  new URL('../src/certification/state-loader.ts', import.meta.url),
  'utf8',
)
const entrypoints = await Promise.all([
  '../src/index.ts',
  '../src/index_with_d1.ts',
  '../src/index_agent_context.ts',
  '../src/index_live_candidate.ts',
  '../src/compat.ts',
  '../src/renderParity.ts',
].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))

for (const required of [
  "const BITGET_PUBLIC_ORIGIN = 'https://api.bitget.com'",
  "const SPOT_CANDLES_PATH = '/api/v2/spot/market/candles'",
  "url.searchParams.set('granularity', '5min')",
  "method: 'GET'",
  "redirect: 'error'",
  "headers: { Accept: 'application/json' }",
  'MAX_RESPONSE_BYTES',
  'REQUEST_TIMEOUT_MS',
  'credentialsUsed: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
]) {
  assert.ok(candleClient.includes(required), `candle client must include ${required}`)
}

for (const required of [
  "version: 'certification-signal-v1'",
  'ema12',
  'ema26',
  'rsi14Bps',
  "volumeMethod: 'CANDLE_DIRECTION_PROXY'",
  'requiresIndependentRiskDecision: true',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
  'Certification candle source hash does not match the candle evidence',
  'Certification signal evidence hash does not match its payload',
]) {
  assert.ok(signalEngine.includes(required), `signal engine must include ${required}`)
}

for (const required of [
  'verifyCertificationSignalEvidence',
  'assessBitgetCandidateOrder',
  "input.request.orderType !== 'MARKET'",
  'reservationApplied: false',
  'automaticallySubmitted: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
  'Object.defineProperty(verified, VERIFIED_CERTIFICATION_SIGNAL_ASSESSMENT',
  'enumerable: false',
]) {
  assert.ok(assessmentBridge.includes(required), `assessment bridge must include ${required}`)
}

for (const required of [
  'assertCertificationSignalAssessmentVerified',
  'accountSpotFillFifo',
  "marketDataSource: 'BITGET_PUBLIC_CLOSED_CANDLES'",
  'providerOrderCreated: false',
  'providerFillClaimed: false',
  'reservationApplied: false',
  'automaticallyPersisted: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
]) {
  assert.ok(fillSimulation.includes(required), `fill simulation must include ${required}`)
}

for (const forbidden of [
  /fetch\s*\(/,
  /createOrder\s*\(/,
  /cancelOrder\s*\(/,
  /requestWithdrawal\s*\(/,
  /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
]) {
  assert.doesNotMatch(fillSimulation, forbidden, `fill simulation must not match ${forbidden}`)
}

for (const required of [
  'verifyCertificationSignalEvidence',
  'assertCertificationSignalAssessmentVerified',
  'assertCertificationFillSimulationVerified',
  'await env.DB.batch(statements)',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
]) {
  assert.ok(evidenceStore.includes(required), `evidence store must include ${required}`)
}

for (const forbidden of [
  /fetch\s*\(/,
  /createOrder\s*\(/,
  /cancelOrder\s*\(/,
  /requestWithdrawal\s*\(/,
  /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
]) {
  assert.doesNotMatch(assessmentBridge, forbidden, `assessment bridge must not match ${forbidden}`)
}

for (const required of [
  'fetchBitgetPublicClosedCandles',
  'evaluateCertificationSignal',
  'assessCertificationSignalCandidate',
  'simulateCertificationFill',
  'explicitProjection.requestedByCaller',
  'automaticallyPersisted: false',
  'providerOrderCreated: false',
  'providerFillClaimed: false',
  'reservationApplied: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
  'automaticRetryAllowed: false',
]) {
  assert.ok(simulationRunner.includes(required), `simulation runner must include ${required}`)
}

for (const forbidden of [
  /createOrder\s*\(/,
  /cancelOrder\s*\(/,
  /requestWithdrawal\s*\(/,
  /setInterval\s*\(/,
  /setTimeout\s*\(/,
]) {
  assert.doesNotMatch(simulationRunner, forbidden, `simulation runner must not match ${forbidden}`)
}

for (const required of [
  'readCertificationActivity',
  'exchangeAccountScoped: true',
  'providerOrderCreated: false',
  'providerFillClaimed: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
  'WHERE a.exchange_account_id = ?',
]) {
  assert.ok(readModel.includes(required), `read model must include ${required}`)
}
assert.doesNotMatch(readModel, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i)
assert.doesNotMatch(readModel, /signalEvidenceHash|assessmentBindingHash|simulationHash/)

for (const required of [
  'loadCertificationSimulationState',
  'verifyCertificationFillSimulationEvidence',
  'WHERE a.exchange_account_id = ? AND f.product_id = ?',
  "source: 'IMMUTABLE_CERTIFICATION_EVIDENCE'",
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
]) {
  assert.ok(stateLoader.includes(required), `state loader must include ${required}`)
}
assert.doesNotMatch(stateLoader, /\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i)

for (const forbidden of [
  /Authorization\s*:/i,
  /ACCESS-(?:KEY|SIGN|PASSPHRASE)/i,
  /BITGET_(?:TRADE|CERT)_API/i,
  /\/api\/v2\/spot\/trade\//i,
  /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
]) {
  assert.doesNotMatch(candleClient, forbidden, `candle client must not match ${forbidden}`)
}

for (const entrypoint of entrypoints) {
  assert.doesNotMatch(
    entrypoint,
    /certification\/(?:bitget-public-candles|signal-engine|signal-assessment-bridge|fill-simulation|evidence-store|simulation-runner|read-model|state-loader)/,
    'source-only certification signal modules must not be imported by deployed entrypoints',
  )
}

console.log('Certification signal safety verified')
