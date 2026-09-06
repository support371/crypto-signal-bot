const CANONICAL_PROJECT_ID = 'prj_sdk3k44uV3pCj5p5njSzHzm1vOJX';
const projectId = process.env.VERCEL_PROJECT_ID?.trim();

if (!projectId) {
  console.log('VERCEL_PROJECT_ID is unavailable; fail open and continue the build.');
  process.exit(1);
}

if (projectId === CANONICAL_PROJECT_ID) {
  console.log(`Canonical Vercel project ${projectId}; continue the build.`);
  process.exit(1);
}

console.log(`Non-canonical Vercel project ${projectId}; ignore this duplicate Git deployment.`);
process.exit(0);
