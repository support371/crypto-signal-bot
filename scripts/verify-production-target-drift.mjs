import { readFile } from 'node:fs/promises';

const CURRENT_WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const OBSOLETE_WORKER = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev';
const OBSOLETE_HARDCODED_ACCOUNT = '5918df72bfd0d0389a1894adec5db58f';

// These files actively drive deployments, diagnostics, runtime clients, or
// machine-readable API contracts. Historical documentation may name a retired
// host explicitly as retired, but active tooling must never target it.
const activeTargets = [
  '.circleci/config.yml',
  '.github/workflows/manual.yml',
  '.github/workflows/monitor.yml',
  '.github/workflows/self-hosted-validate.yml',
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

for (const path of activeTargets) {
  const content = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
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
  const content = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
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

if (failures.length > 0) {
  console.error('Production target drift verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Production target drift verification passed: active release tooling is aligned to ${CURRENT_WORKER} and contains no obsolete hard-coded account id.`);
