import { mkdir, readFile, writeFile } from 'node:fs/promises';

const packageJsonUrl = new URL('../package.json', import.meta.url);
const outputUrl = new URL('../public/certification-status.json', import.meta.url);

function safeCommit(value) {
  return typeof value === 'string' && /^[a-f0-9]{7,40}$/i.test(value) ? value.slice(0, 12) : 'unknown';
}

function safeEnvironment(value) {
  return value === 'production' || value === 'preview' || value === 'development' ? value : 'static';
}

const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8'));
const packageVersion = typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
const commit = safeCommit(
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA,
);
const buildVersion = commit === 'unknown' ? `${packageVersion}-dev` : `${packageVersion}-dev+${commit}`;

const snapshot = {
  schemaVersion: 'certification-status.v1',
  mode: 'CERTIFICATION',
  readOnly: true,
  generatedAt: new Date().toISOString(),
  release: {
    packageVersion: buildVersion,
    channel: 'static-build-candidate',
    commit,
    environment: safeEnvironment(process.env.VERCEL_ENV),
  },
  services: {
    publicApplication: 'available',
    certificationMirror: 'static-build',
    connectedDashboard: 'external-health-required',
    userAuthentication: 'configuration-required',
    operatorGateway: 'disconnected',
  },
  capabilities: {
    deploymentAllowed: false,
    providerMutationAllowed: false,
    executionAllowed: false,
    mainnetAllowed: false,
    realFundsAllowed: false,
    withdrawalsAllowed: false,
    automaticRetryAllowed: false,
  },
};

await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(outputUrl, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

console.log(`wrote static certification status: ${buildVersion}`);
