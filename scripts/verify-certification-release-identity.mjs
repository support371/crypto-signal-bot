import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const endpoint = await readFile(new URL('../api/certification/status.js', import.meta.url), 'utf8');
const staticWriter = await readFile(new URL('./write-static-certification-status.mjs', import.meta.url), 'utf8');
const client = await readFile(new URL('../src/lib/certificationStatusApi.ts', import.meta.url), 'utf8');

for (const required of [
  "const PACKAGE_VERSION = '0.0.0'",
  'function certificationBuildVersion(commit)',
  "`${PACKAGE_VERSION}-dev`",
  "`${PACKAGE_VERSION}-dev+${commit}`",
  'packageVersion: certificationBuildVersion(commit)',
  "channel: 'preview-candidate'",
]) {
  assert.ok(endpoint.includes(required), `runtime certification identity must include ${required}`);
}

for (const required of [
  'const buildVersion = commit === \'unknown\'',
  "`${packageVersion}-dev`",
  "`${packageVersion}-dev+${commit}`",
  'packageVersion: buildVersion',
  "channel: 'static-build-candidate'",
]) {
  assert.ok(staticWriter.includes(required), `static certification identity must include ${required}`);
}

for (const required of [
  'const BUILD_VERSION_PATTERN',
  'const COMMIT_PATTERN',
  "['preview-candidate', 'static-build-candidate']",
  "['production', 'preview', 'development', 'static', 'unknown']",
  "['available', 'static-build']",
  "['disconnected']",
  'Certification status response has an invalid development build version',
  'Certification status response has inconsistent release identity',
  'versionCommit !== commit.toLowerCase()',
]) {
  assert.ok(client.includes(required), `certification client identity validation must include ${required}`);
}

for (const forbidden of [
  /channel:\s*'production'/i,
  /operatorGateway:\s*'connected'/i,
  /packageVersion:\s*'1\.0\.0'/i,
]) {
  assert.doesNotMatch(`${endpoint}\n${staticWriter}\n${client}`, forbidden, `certification identity must not match ${forbidden}`);
}

console.log('certification release identity verified');
