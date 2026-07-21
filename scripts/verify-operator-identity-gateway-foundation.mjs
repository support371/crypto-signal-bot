import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../src/server/operatorIdentityGateway.ts', import.meta.url), 'utf8');
const bounded = await readFile(new URL('../src/server/boundedOperatorIdentityGateway.ts', import.meta.url), 'utf8');
const aggregator = await readFile(new URL('../src/server/operatorReadOnlyAggregator.ts', import.meta.url), 'utf8');
const sessionVerifier = await readFile(new URL('../src/server/trustedOperatorSessionVerifier.ts', import.meta.url), 'utf8');
const placeholder = await readFile(new URL('../api/operator/readiness.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../contracts/operator-readiness-response.schema.json', import.meta.url), 'utf8');

JSON.parse(schema);

for (const required of [
  "'ACTIVATION_GATE'",
  "'DEPLOYMENT_READINESS'",
  "'OPERATIONAL_REHEARSAL'",
  "'CERTIFICATION'",
  "'RECOVERY_READINESS'",
  "'RECONCILIATION'",
  "'ALERTS'",
  "'AUDIT_HEAD'",
  "'AAL2'",
  "'AAL3'",
  'verifySession(request: Request, signal: AbortSignal)',
  'resolveAuthorization(',
  'aggregateReadOnlyEvidence(',
  'BROWSER_AUTHORITY_HEADERS_FORBIDDEN',
  'OPERATOR_SESSION_REQUIRED',
  'OPERATOR_SCOPE_FORBIDDEN',
  'OPERATOR_GATEWAY_TIMEOUT',
  'aggregated account evidence escaped the authorized scope',
  'deploymentAllowed: false',
  'demoRequestAllowed: false',
  'credentialsRead: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'liveExecutionAllowed: false',
  'realFundsAllowed: false',
  'mainnetAllowed: false',
  'withdrawalsAllowed: false',
  'automaticRetryAllowed: false',
  'accountingAutomaticallyDispatched: false',
]) {
  assert.ok(core.includes(required), `gateway core must include ${required}`);
}

for (const required of [
  'raceWithAbort',
  "new DOMException('Operator gateway deadline exceeded', 'AbortError')",
  "signal.addEventListener('abort'",
  'createOperatorIdentityGateway(boundedDependencies)',
]) {
  assert.ok(bounded.includes(required), `bounded gateway must include ${required}`);
}

for (const forbidden of [
  /\bfetch\s*\(/i,
  /process\.env/i,
  /localStorage/i,
  /sessionStorage/i,
  /document\.cookie/i,
  /deploymentAllowed:\s*true/i,
  /demoRequestAllowed:\s*true/i,
  /credentialsRead:\s*true/i,
  /providerMutationAllowed:\s*true/i,
  /executionAllowed:\s*true/i,
  /liveExecutionAllowed:\s*true/i,
  /realFundsAllowed:\s*true/i,
  /mainnetAllowed:\s*true/i,
  /withdrawalsAllowed:\s*true/i,
  /automaticRetryAllowed:\s*true/i,
  /accountingAutomaticallyDispatched:\s*true/i,
]) {
  assert.doesNotMatch(`${core}\n${bounded}`, forbidden, `gateway foundation must not match ${forbidden}`);
}

for (const required of [
  'workerOrigin: string',
  'fetcher(input: RequestInfo | URL, init?: RequestInit): Promise<Response>',
  'resolveCredential(',
  "'/v1/operator/activation-gate'",
  "'/v1/operator/deployment-readiness'",
  "'/v1/operator/operational-readiness'",
  "'/v1/operator/certification'",
  "'/v1/operator/recovery-readiness'",
  "'/v1/operator/reconciliation'",
  "'/v1/operator/alerts'",
  "'/v1/operator/audit-head'",
  "redirect: 'error'",
  "credentials: 'omit'",
  "cache: 'no-store'",
  "method: 'GET'",
  "'X-Operator-Id': credential.actorId",
  "'X-API-Key': credential.apiKey",
  'maxResponseBytes',
  'maxAggregateBytes',
  'response.arrayBuffer()',
  'Promise.all(resources.map',
  'upstream evidence escaped the authorized account',
  'upstream evidence escaped the authorized product',
  'operator resource returned an unexpected status',
  'activation_resource_not_visible',
  'deploymentAllowed: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realFundsAllowed: false',
  'withdrawalsAllowed: false',
]) {
  assert.ok(aggregator.includes(required), `operator aggregator must include ${required}`);
}

for (const forbidden of [
  /process\.env/i,
  /localStorage/i,
  /sessionStorage/i,
  /document\.cookie/i,
  /window\./i,
  /axios/i,
  /setInterval/i,
  /deploymentAllowed:\s*true/i,
  /demoRequestAllowed:\s*true/i,
  /credentialsRead:\s*true/i,
  /providerMutationAllowed:\s*true/i,
  /executionAllowed:\s*true/i,
  /liveExecutionAllowed:\s*true/i,
  /realFundsAllowed:\s*true/i,
  /mainnetAllowed:\s*true/i,
  /withdrawalsAllowed:\s*true/i,
  /automaticRetryAllowed:\s*true/i,
  /accountingAutomaticallyDispatched:\s*true/i,
]) {
  assert.doesNotMatch(aggregator, forbidden, `operator aggregator must not match ${forbidden}`);
}

for (const required of [
  'verifySignedSession(',
  'inspectSessionState(',
  'resolveSubject(',
  'issuer !== config.issuer || audience !== config.audience',
  'session assurance is below the operator policy',
  'session exceeds its maximum age',
  'session authentication is too old',
  'operator session is revoked',
  'operator session replay was rejected',
  'operator subject is disabled or unmapped',
  'trusted session clock is unavailable',
  "status: 'AUTHENTICATED'",
  "status: 'UNAUTHENTICATED'",
  "status: 'UNAVAILABLE'",
]) {
  assert.ok(sessionVerifier.includes(required), `trusted session verifier must include ${required}`);
}

for (const forbidden of [
  /process\.env/i,
  /localStorage/i,
  /sessionStorage/i,
  /document\.cookie/i,
  /window\./i,
  /\bfetch\s*\(/i,
  /\baxios\b/i,
  /jsonwebtoken/i,
  /from\s+['"]jose['"]/i,
  /crypto\.subtle/i,
  /X-API-Key/i,
  /Authorization/i,
  /\bCookie\b/i,
]) {
  assert.doesNotMatch(sessionVerifier, forbidden, `trusted session verifier must not match ${forbidden}`);
}

for (const required of [
  "code: 'OPERATOR_IDENTITY_GATEWAY_NOT_CONFIGURED'",
  'sendJson(response, 503',
  "response.setHeader('Allow', 'GET, HEAD, OPTIONS')",
]) {
  assert.ok(placeholder.includes(required), `production placeholder must include ${required}`);
}

for (const forbidden of [
  'operatorIdentityGateway',
  'boundedOperatorIdentityGateway',
  'operatorReadOnlyAggregator',
  'trustedOperatorSessionVerifier',
  'verifySession',
  'verifySignedSession',
  'resolveAuthorization',
  'aggregateReadOnlyEvidence',
  'resolveCredential',
]) {
  assert.ok(!placeholder.includes(forbidden), `production placeholder must remain disconnected from ${forbidden}`);
}

for (const required of [
  '"OPERATIONAL_REHEARSAL"',
  '"deploymentAllowed": { "const": false }',
  '"executionAllowed": { "const": false }',
  '"withdrawalsAllowed": { "const": false }',
]) {
  assert.ok(schema.includes(required), `response schema must include ${required}`);
}

console.log('operator identity gateway foundation verified');
