import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const client = await readFile(new URL('../src/lib/operatorReadinessApi.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/OperatorReadiness.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/AppCore.tsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/LayoutCore.tsx', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../api/operator/readiness.js', import.meta.url), 'utf8');
const tests = await readFile(new URL('../src/tests/operator_readiness_contracts.test.ts', import.meta.url), 'utf8');
const browserBoundary = `${client}\n${page}`;

for (const required of [
  "OPERATOR_READINESS_GATEWAY_PATH = '/api/operator/readiness'",
  "method: 'GET'",
  "credentials: 'same-origin'",
  "cache: 'no-store'",
  "redirect: 'error'",
  "headers: { Accept: 'application/json' }",
  'hasPermanentFalseLocks',
  "gatewayStatus: 'available'",
  "'invalid_response'",
  'activationEnabled: false',
  'activationBlocked: true',
  'realMoneyMovementAllowed: false',
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
  assert.ok(client.includes(required), `operator frontend client must include ${required}`);
}

for (const required of [
  'Browser credentials are not accepted or stored.',
  'This page cannot submit orders',
  'The browser cannot supply one.',
  'Review-ready does not authorize deployment.',
]) {
  assert.ok(page.includes(required), `operator frontend page must include ${required}`);
}

for (const required of [
  "code: 'OPERATOR_IDENTITY_GATEWAY_NOT_CONFIGURED'",
  'sendJson(response, 503',
  "response.setHeader('Allow', 'GET, HEAD, OPTIONS')",
  "'X-Operator-Gateway': 'not-configured'",
  'gatewayConfigured: false',
  'activationEnabled: false',
  'deploymentAllowed: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'realMoneyMovementAllowed: false',
  'withdrawalsAllowed: false',
]) {
  assert.ok(gateway.includes(required), `operator gateway placeholder must include ${required}`);
}

for (const required of [
  'path="/operator-readiness"',
  '<ProtectedPage>',
]) {
  assert.ok(app.includes(required), `operator frontend route must include ${required}`);
}
assert.ok(layout.includes('to="/operator-readiness"'), 'operator frontend navigation link is missing');
assert.ok(tests.includes('operator readiness browser source safety'), 'operator frontend source-safety test is missing');

for (const forbidden of [
  /localStorage/i,
  /sessionStorage/i,
  /document\.cookie/i,
  /Authorization\s*:/i,
  /X-API-Key/i,
  /X-Operator-Id/i,
  /\/v1\/operator\//,
  /VITE_.*(?:OPERATOR|API_KEY|SECRET)/i,
  /credentials\s*:\s*['"]include['"]/i,
  /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i,
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
  assert.doesNotMatch(browserBoundary, forbidden, `operator frontend boundary must not match ${forbidden}`);
}

for (const forbidden of [
  /request\.headers/i,
  /request\.body/i,
  /process\.env/i,
  /fetch\s*\(/i,
  /Authorization/i,
  /X-API-Key/i,
  /X-Operator-Id/i,
  /secret/i,
  /credential/i,
  /providerMutationAllowed:\s*true/i,
  /executionAllowed:\s*true/i,
  /withdrawalsAllowed:\s*true/i,
]) {
  assert.doesNotMatch(gateway, forbidden, `operator gateway placeholder must not match ${forbidden}`);
}

console.log('operator frontend safety verified');
