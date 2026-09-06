const CANONICAL_PROJECT_ID = 'prj_sdk3k44uV3pCj5p5njSzHzm1vOJX';
const CANONICAL_PRODUCTION_HOST = 'crypto-signal-bot-indol.vercel.app';

const projectId = process.env.VERCEL_PROJECT_ID?.trim();
const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ?.trim()
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');

if (!projectId && !productionHost) {
  console.log('Vercel project identity is unavailable; fail open and continue the build.');
  process.exit(1);
}

if (projectId === CANONICAL_PROJECT_ID || productionHost === CANONICAL_PRODUCTION_HOST) {
  console.log(
    `Canonical Vercel target detected (${projectId ?? 'no-project-id'} / ${productionHost ?? 'no-production-host'}); continue the build.`,
  );
  process.exit(1);
}

console.log(
  `Non-canonical Vercel target (${projectId ?? 'no-project-id'} / ${productionHost ?? 'no-production-host'}); ignore this duplicate Git deployment.`,
);
process.exit(0);
