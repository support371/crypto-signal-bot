import { readFile } from 'node:fs/promises';

const CURRENT_WORKER = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
const CURRENT_FRONTEND = 'https://crypto-signal-bot-indol.vercel.app';
const PRIMARY = 'btcc';
const SECONDARY = 'bitget';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Production contract drift: ${message}`);
}

const [
  releaseText,
  envSource,
  packageText,
  wrangler,
  vercelText,
  probeSource,
  verifierSource,
  appSource,
  statusSource,
  managementSource,
] = await Promise.all([
  text('public/release.json'),
  text('src/lib/env.ts'),
  text('package.json'),
  text('wrangler.toml'),
  text('vercel.json'),
  text('api/new-backend-probe.js'),
  text('scripts/verify-deployed-paper-release.mjs'),
  text('src/AppCore.tsx'),
  text('src/pages/ProductionStatus.tsx'),
  text('worker/src/management.ts'),
]);

const release = JSON.parse(releaseText);
const pkg = JSON.parse(packageText);
const vercel = JSON.parse(vercelText);

assert(release.application === 'crypto-signal-bot', 'release application identity changed');
assert(release.canonical_frontend_url === CURRENT_FRONTEND, 'canonical frontend URL is stale');
assert(release.dashboard_path === '/dashboard', 'dashboard path must remain /dashboard');
assert(release.account_path === '/account', 'account-management path is missing');
assert(release.admin_path === '/admin', 'admin-management path is missing');
assert(release.management_api_path === '/v1/management', 'management API path is missing');
assert(release.status_path === '/status', 'production status path is missing');
assert(release.attestation_path === '/api/release-attestation', 'attestation endpoint is missing');
assert(release.backend_url === CURRENT_WORKER, 'release manifest points to the wrong Worker');
assert(release.execution_exchange_primary === PRIMARY, 'BTCC must remain the primary execution exchange');
assert(release.execution_exchange_secondary === SECONDARY, 'Bitget must remain the secondary execution exchange');
assert(
  Array.isArray(release.execution_exchanges)
    && release.execution_exchanges.length === 2
    && release.execution_exchanges[0] === PRIMARY
    && release.execution_exchanges[1] === SECONDARY,
  'execution exchange order must remain [btcc, bitget]',
);
assert(release.trading_mode === 'paper', 'release trading mode must remain paper');
assert(release.network === 'testnet', 'release network must remain testnet');
assert(release.live_trading_enabled === false, 'release must not enable live trading');
assert(release.withdrawals_enabled === false, 'release must not enable withdrawals');
assert(release.real_funds_enabled === false, 'release must not enable real funds');
assert(release.provider_mutation_enabled === false, 'release must not enable provider mutation');
assert(release.canonical_demo_identity_enabled === false, 'canonical production must not enable demo identity');

assert(envSource.includes(`CURRENT_PRODUCTION_BACKEND_URL = '${CURRENT_WORKER}'`), 'frontend runtime Worker constant drifted');
assert(envSource.includes("CANONICAL_PRODUCTION_HOST = 'crypto-signal-bot-indol.vercel.app'"), 'canonical host demo lock drifted');
assert(envSource.includes('configured && !isCanonicalProductionHost()'), 'canonical domain must suppress demo identity');
assert(probeSource.includes(`const WORKER = '${CURRENT_WORKER}'`), 'Vercel attestation Worker drifted');
assert(verifierSource.includes(`DEFAULT_BACKEND_URL = '${CURRENT_WORKER}'`), 'deployment verifier Worker drifted');
assert(verifierSource.includes(`DEFAULT_FRONTEND_URL = '${CURRENT_FRONTEND}'`), 'deployment verifier frontend drifted');
assert(appSource.includes('path="/status"'), 'public production status route is not registered');
assert(appSource.includes('path="/account"'), 'account route is not registered');
assert(appSource.includes("'/admin/users'"), 'admin user management route is not registered');
assert(appSource.includes('AdministrativePage'), 'admin routes are not authorization-gated');
assert(statusSource.includes("'/api/release-attestation'"), 'production status page is not bound to release attestation');
assert(statusSource.includes('BTCC primary · Bitget secondary'), 'production status page lost the canonical execution hierarchy');
assert(managementSource.includes("'/auth/v1/user'"), 'Worker management auth must validate the external bearer session');
assert(managementSource.includes('SEPARATION_OF_DUTIES'), 'management separation-of-duties control is missing');

assert(wrangler.includes('TRADING_MODE = "paper"'), 'Wrangler trading mode must remain paper');
assert(wrangler.includes('EXCHANGE_MODE = "paper"'), 'Wrangler exchange mode must remain paper');
assert(wrangler.includes('NETWORK = "testnet"'), 'Wrangler network must remain testnet');
assert(wrangler.includes('ALLOW_MAINNET = "false"'), 'Wrangler mainnet lock must remain false');
assert(wrangler.includes('EXECUTION_EXCHANGE_PRIMARY = "btcc"'), 'Wrangler primary execution exchange must remain BTCC');
assert(wrangler.includes('EXECUTION_EXCHANGE_SECONDARY = "bitget"'), 'Wrangler secondary execution exchange must remain Bitget');
assert(wrangler.includes('binding = "AGENT_MEMORY"'), 'AGENT_MEMORY KV binding is missing');
assert(wrangler.includes('id = "2dcb1050b9c846a7bba8cd1c3c43df62"'), 'AGENT_MEMORY KV namespace id drifted');
assert(wrangler.includes(CURRENT_FRONTEND), 'canonical frontend is missing from Worker CORS origins');

assert(Array.isArray(vercel.alias) && vercel.alias.includes('crypto-signal-bot-indol.vercel.app'), 'canonical Vercel alias is missing');
assert(vercel.framework === 'vite', 'Vercel framework must remain Vite');
assert(vercel.buildCommand === 'npm run build', 'Vercel must execute the guarded npm build command');

assert(pkg.scripts?.build?.includes('verify:production-contract'), 'production drift verifier must gate frontend builds');
assert(pkg.scripts?.build?.includes('verify:usage-management'), 'usage-management verifier must gate frontend builds');
assert(pkg.scripts?.lint?.includes('src/pages/ProductionStatus.tsx'), 'production status surface must remain in strict lint coverage');
assert(pkg.scripts?.lint?.includes('src/pages/AdminCenter.tsx'), 'admin management surface must remain in strict lint coverage');
assert(pkg.scripts?.['verify:deployment']?.includes('verify-production-attestation.mjs'), 'deployment verification must include production attestation');
assert(pkg.scripts?.['deploy:paper-worker']?.includes(CURRENT_WORKER), 'Worker deploy smoke target is stale');

console.log('Static production contract verified: Vercel→Cloudflare wiring, identity/usage management surfaces, BTCC→Bitget hierarchy, KV binding, lint coverage, and paper/testnet locks are aligned.');
