import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const endpoint = await readFile(new URL('../api/certification/status.js', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/lib/certificationStatusApi.ts', import.meta.url), 'utf8');
const page = await readFile(new URL('../src/pages/CertificationOverview.tsx', import.meta.url), 'utf8');
const vercel = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');

JSON.parse(vercel);

for (const required of [
  "'Cache-Control': 'no-store'",
  "'X-Certification-Mirror': 'read-only'",
  "response.setHeader('Allow', 'GET, HEAD, OPTIONS')",
  "schemaVersion: 'certification-status.v1'",
  "mode: 'CERTIFICATION'",
  'readOnly: true',
  "packageVersion: '0.0.0'",
  "channel: 'preview-candidate'",
  'safeCommit(process.env.VERCEL_GIT_COMMIT_SHA)',
  'safeDeploymentEnvironment(process.env.VERCEL_ENV)',
  "operatorGateway: 'disconnected'",
  'deploymentAllowed: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'mainnetAllowed: false',
  'realFundsAllowed: false',
  'withdrawalsAllowed: false',
  'automaticRetryAllowed: false',
]) {
  assert.ok(endpoint.includes(required), `certification mirror must include ${required}`);
}

for (const forbidden of [
  /\bfetch\s*\(/i,
  /request\.body/i,
  /authorization/i,
  /document\.cookie/i,
  /localStorage/i,
  /sessionStorage/i,
  /api[_-]?key/i,
  /secret/i,
  /deploymentAllowed:\s*true/i,
  /providerMutationAllowed:\s*true/i,
  /executionAllowed:\s*true/i,
  /mainnetAllowed:\s*true/i,
  /realFundsAllowed:\s*true/i,
  /withdrawalsAllowed:\s*true/i,
  /automaticRetryAllowed:\s*true/i,
]) {
  assert.doesNotMatch(endpoint, forbidden, `certification mirror must not match ${forbidden}`);
}

for (const required of [
  "CERTIFICATION_STATUS_ROUTE = '/api/certification/status'",
  "method: 'GET'",
  "credentials: 'omit'",
  "redirect: 'error'",
  "cache: 'no-store'",
  "value.schemaVersion !== 'certification-status.v1'",
  "value.mode !== 'CERTIFICATION'",
  'value.readOnly !== true',
  'value.capabilities[key] !== false',
]) {
  assert.ok(client.includes(required), `certification client must include ${required}`);
}

for (const forbidden of [
  /credentials:\s*'include'/i,
  /authorization/i,
  /localStorage/i,
  /sessionStorage/i,
]) {
  assert.doesNotMatch(client, forbidden, `certification client must not match ${forbidden}`);
}

for (const required of [
  'MIRROR_TIMEOUT_MS = 3_000',
  'static fallback',
  'All operational capabilities locked',
  '/api/certification/status',
  'Exact deployment metadata will appear when the read-only mirror responds.',
]) {
  assert.ok(page.includes(required), `certification overview must include ${required}`);
}

assert.ok(vercel.includes('(?!api/|assets/|.*\\..*)'), 'SPA rewrite must continue excluding API routes');

console.log('certification status mirror verified');
