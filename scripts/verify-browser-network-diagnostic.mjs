import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/browser-network-diagnostic.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/browser-network-diagnostic.js', import.meta.url), 'utf8');

for (const required of [
  'Browser network diagnostic',
  'Platform server → Worker',
  'This browser → Worker',
  'Run read-only diagnostic',
  "connect-src 'self' https://*.workers.dev",
  'script-src \'self\'',
  'referrer" content="no-referrer',
  '/browser-network-diagnostic.js',
  'No body read; zero retries',
]) {
  assert.ok(html.includes(required), `browser diagnostic HTML must include ${required}`);
}

for (const forbidden of [
  /<script(?![^>]*\bsrc=)/i,
  /<form\b/i,
  /<iframe\b/i,
  /target=["']_blank/i,
]) {
  assert.doesNotMatch(html, forbidden, `browser diagnostic HTML must not match ${forbidden}`);
}

for (const required of [
  "const SERVER_DIAGNOSTIC_ROUTE = '/api/certification/backend-health'",
  'const REQUEST_TIMEOUT_MS = 6_000',
  "host.endsWith('.workers.dev')",
  "`https://${host}/health`",
  "method: 'GET'",
  "credentials: 'omit'",
  "redirect: 'error'",
  "cache: 'no-store'",
  "state: timedOut ? 'timeout' : 'network-or-cors-error'",
  "runButton.addEventListener('click'",
  'void runDiagnostic();',
]) {
  assert.ok(script.includes(required), `browser diagnostic script must include ${required}`);
}

assert.equal(
  (script.match(/\bfetch\s*\(/g) ?? []).length,
  1,
  'browser diagnostic must route both bounded requests through one fetch helper',
);
assert.equal(
  (script.match(/readBrowserPath\s*\(/g) ?? []).length,
  2,
  'browser path diagnostic must have one declaration and one invocation',
);

const browserPathStart = script.indexOf('async function readBrowserPath');
const interpretationStart = script.indexOf('function renderInterpretation');
assert.ok(browserPathStart >= 0 && interpretationStart > browserPathStart, 'browser path function must be isolated');
const browserPath = script.slice(browserPathStart, interpretationStart);
for (const forbidden of [/\.json\s*\(/i, /\.text\s*\(/i, /\.arrayBuffer\s*\(/i, /\.blob\s*\(/i, /\.formData\s*\(/i, /\.body\b/i]) {
  assert.doesNotMatch(browserPath, forbidden, `browser Worker response must not match ${forbidden}`);
}

for (const forbidden of [
  /authorization/i,
  /document\.cookie/i,
  /localStorage/i,
  /sessionStorage/i,
  /credentials:\s*'include'/i,
  /setInterval/i,
  /while\s*\(/i,
  /request\.body/i,
  /api[_-]?key/i,
  /secret/i,
]) {
  assert.doesNotMatch(script, forbidden, `browser diagnostic script must not match ${forbidden}`);
}

console.log('browser and server network-path diagnostic verified');
