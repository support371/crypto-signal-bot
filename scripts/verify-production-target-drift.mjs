import { readFile } from 'node:fs/promises';

const CURRENT_WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const OBSOLETE_WORKER = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev';
const OBSOLETE_HARDCODED_ACCOUNT = '5918df72bfd0d0389a1894adec5db58f';
const CANONICAL_VERCEL_PROJECT_ID = 'prj_sdk3k44uV3pCj5p5njSzHzm1vOJX';

// These files actively drive deployments, diagnostics, runtime clients, or
// machine-readable API contracts. Historical documentation may name a retired
// host explicitly as retired, but active tooling must never target it.
const activeTargets = [
  '.circleci/config.yml',
  '.github/workflows/manual.yml',
  '.github/workflows/monitor.yml',
  '.github/workflows/self-hosted-validate.yml',
  '.github/workflows/self-hosted-release.yml',
  '.github/workflows/render-keepalive.yml',
  'scripts/deploy-worker.sh',
  'scripts/vercel-sync-backend-url.mjs',
  'scripts/verify-deployed-paper-release.mjs',
  'scripts/verify-production-attestation.mjs',
  'worker/scripts/smoke-check.mjs',
  'gpt-actions/worker-api.openapi.yaml',
  'gpt-actions/url/cryptoops-worker-readonly.yaml',
  'README_DEPLOY_HANDOFF.md',
  'VERCEL_UPDATE.md',
  'DEPLOYMENT_STATUS.md',
];

const failures = [];

async function readActiveTarget(path) {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  } catch (error) {
    if (path === '.circleci/config.yml' && error?.code === 'ENOENT') return null;
    throw error;
  }
}

for (const path of activeTargets) {
  const content = await readActiveTarget(path);
  if (content === null) continue;
  if (content.includes(OBSOLETE_WORKER)) {
    failures.push(`${path}: still references obsolete Worker ${OBSOLETE_WORKER}`);
  }
  if (content.includes(OBSOLETE_HARDCODED_ACCOUNT)) {
    failures.push(`${path}: still contains obsolete hard-coded Cloudflare account id`);
  }
}

const expectedCurrentWorkerPaths = [
  '.circleci/config.yml',
  '.github/workflows/manual.yml',
  '.github/workflows/monitor.yml',
  '.github/workflows/self-hosted-validate.yml',
  '.github/workflows/self-hosted-release.yml',
  'scripts/deploy-worker.sh',
  'scripts/vercel-sync-backend-url.mjs',
  'scripts/verify-deployed-paper-release.mjs',
  'scripts/verify-production-attestation.mjs',
  'worker/scripts/smoke-check.mjs',
  'gpt-actions/worker-api.openapi.yaml',
  'gpt-actions/url/cryptoops-worker-readonly.yaml',
  'README_DEPLOY_HANDOFF.md',
];

for (const path of expectedCurrentWorkerPaths) {
  const content = await readActiveTarget(path);
  if (content === null) continue;
  if (!content.includes(CURRENT_WORKER)) {
    failures.push(`${path}: does not identify the canonical migrated Worker`);
  }
}

const deployScript = await readFile(new URL('../scripts/deploy-worker.sh', import.meta.url), 'utf8');
if (!deployScript.includes('CLOUDFLARE_ACCOUNT_ID')) {
  failures.push('scripts/deploy-worker.sh: account id must be supplied from the environment');
}
if (/ACCOUNT_ID=["'][a-f0-9]{32}["']/i.test(deployScript)) {
  failures.push('scripts/deploy-worker.sh: Cloudflare account id must not be hard-coded');
}

const vercelConfig = await readFile(new URL('../vercel.json', import.meta.url), 'utf8');
const vercelIgnoreScript = await readFile(new URL('../scripts/vercel-ignore-noncanonical-project.mjs', import.meta.url), 'utf8');
if (!vercelConfig.includes('scripts/vercel-ignore-noncanonical-project.mjs')) {
  failures.push('vercel.json: duplicate-project ignore gate is not configured');
}
if (!vercelIgnoreScript.includes(CANONICAL_VERCEL_PROJECT_ID)) {
  failures.push('scripts/vercel-ignore-noncanonical-project.mjs: canonical Vercel project id is missing');
}
if (!vercelIgnoreScript.includes('process.exit(1)') || !vercelIgnoreScript.includes('process.exit(0)')) {
  failures.push('scripts/vercel-ignore-noncanonical-project.mjs: ignore gate must explicitly continue canonical builds and ignore duplicates');
}

if (failures.length > 0) {
  console.error('Production target drift verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production target drift verification passed: Worker=${CURRENT_WORKER}; canonical Vercel project=${CANONICAL_VERCEL_PROJECT_ID}; duplicate project builds are gated; no obsolete hard-coded account id remains in active release tooling.`);
