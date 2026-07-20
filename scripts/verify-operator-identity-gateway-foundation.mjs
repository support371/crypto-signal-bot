import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../src/server/operatorIdentityGateway.ts', import.meta.url), 'utf8');
const bounded = await readFile(new URL('../src/server/boundedOperatorIdentityGateway.ts', import.meta.url), 'utf8');
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
  "code: 'OPERATOR_IDENTITY_GATEWAY_NOT_CONFIGURED'",
  'sendJson(response, 503',
  "response.setHeader('Allow', 'GET, HEAD, OPTIONS')",
]) {
  assert.ok(placeholder.includes(required), `production placeholder must include ${required}`);
}

for (const forbidden of [
  'operatorIdentityGateway',
  'boundedOperatorIdentityGateway',
  'verifySession',
  'resolveAuthorization',
  'aggregateReadOnlyEvidence',
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
