import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const client = await readFile(new URL('../src/lib/operatorReadinessApi.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/OperatorReadiness.tsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/AppCore.tsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/LayoutCore.tsx', import.meta.url), 'utf8');
const gateway = await readFile(new URL('../api/operator/readiness.js', import.meta.url), 'utf8');
const responseSchema = await readFile(new URL('../contracts/operator-readiness-response.schema.json', import.meta.url), 'utf8');
const settingsModal = await readFile(new URL('../src/components/dashboard/SettingsModal.tsx', import.meta.url), 'utf8');
const settingsDefaults = await readFile(new URL('../src/components/dashboard/settingsDefaults.ts', import.meta.url), 'utf8');
const persistedSettings = await readFile(new URL('../src/hooks/usePersistedSettings.ts', import.meta.url), 'utf8');
const backendRuntime = await readFile(new URL('../src/lib/backendRuntime.ts', import.meta.url), 'utf8');
const browserBoundary = `${client}\n${page}`;
const settingsBoundary = `${settingsModal}\n${settingsDefaults}`;

JSON.parse(responseSchema);

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
  "'OPERATIONAL_REHEARSAL'",
  'operationalScenarios',
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
  'Operational rehearsal evidence',
  'Evidence is review-only and cannot run an operation.',
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
  '"additionalProperties": false',
  '"OPERATIONAL_REHEARSAL"',
  '"READY_FOR_INDEPENDENT_REVIEW"',
  '"deploymentAllowed": { "const": false }',
  '"executionAllowed": { "const": false }',
  '"withdrawalsAllowed": { "const": false }',
]) {
  assert.ok(responseSchema.includes(required), `operator response schema must include ${required}`);
}

for (const required of [
  'path="/operator-readiness"',
  '<ProtectedPage>',
]) {
  assert.ok(app.includes(required), `operator frontend route must include ${required}`);
}
assert.ok(layout.includes('to="/operator-readiness"'), 'operator frontend navigation link is missing');

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

for (const forbidden of [
  /operatorApiKey/i,
  /readOperatorApiKey/i,
  /writeOperatorApiKey/i,
  /X-API-Key/i,
  /VITE_.*(?:OPERATOR|API_KEY|SECRET)/i,
]) {
  assert.doesNotMatch(settingsBoundary, forbidden, `browser settings must not expose operator credentials: ${forbidden}`);
}

assert.ok(
  persistedSettings.includes('Rewrite immediately so legacy fields such as operatorApiKey are removed.'),
  'persisted settings must scrub legacy operator key fields',
);
assert.ok(
  backendRuntime.includes('getCurrentAccessToken'),
  'backend runtime must source user authentication from the current application session',
);
assert.ok(
  backendRuntime.includes("headers.set('Authorization', `Bearer ${accessToken}`)"),
  'backend runtime must send the current authenticated bearer session',
);
assert.doesNotMatch(
  backendRuntime,
  /headers\.set\(['"]X-API-Key['"]/i,
  'backend runtime must never attach the server operator key from the browser',
);

console.log('operator frontend safety verified');