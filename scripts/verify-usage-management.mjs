import { readFile } from 'node:fs/promises';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(`Usage-management contract violation: ${message}`);
}

const [
  management,
  migration,
  router,
  app,
  envSource,
  authContext,
  authProvider,
  account,
  admin,
  releaseText,
] = await Promise.all([
  text('worker/src/management.ts'),
  text('worker/migrations/031_usage_management.sql'),
  text('worker/src/index_with_d1.ts'),
  text('src/AppCore.tsx'),
  text('src/lib/env.ts'),
  text('src/context/AuthContext.ts'),
  text('src/context/AuthProvider.tsx'),
  text('src/pages/Account.tsx'),
  text('src/pages/AdminCenter.tsx'),
  text('public/release.json'),
]);
const release = JSON.parse(releaseText);

for (const token of [
  'app_user_profiles',
  'live_actor_roles',
  'management_audit_events',
  'app_usage_daily',
  'management_rate_windows',
  'session_security_events',
  "'RELEASE_ADMIN'",
  "'RISK_ADMIN'",
  "'AUDITOR'",
  'verifySupabaseIdentity',
  '/auth/v1/user',
  'SEPARATION_OF_DUTIES',
  'RATE_LIMITED',
  'provider_mutation_enabled: false',
  'live_trading_enabled: false',
  'withdrawals_enabled: false',
]) {
  assert(management.includes(token), `management implementation is missing ${token}`);
}

assert(management.includes("path === '/v1/management/bootstrap'"), 'bootstrap route is missing');
assert(router.includes('isManagementBootstrap && !requireApiKey(env, request)'), 'bootstrap must require server API key');
assert(router.includes("url.pathname.startsWith('/v1/management/')"), 'management router is not connected to Worker');
assert(!management.includes('localStorage'), 'Worker management code must never depend on browser storage');
assert(!management.includes('demo-paper-token'), 'demo token must never be accepted by Worker management auth');

for (const token of [
  'CREATE TABLE IF NOT EXISTS app_user_profiles',
  'CREATE TABLE IF NOT EXISTS management_audit_events',
  'management_audit_events_no_update',
  'management_audit_events_no_delete',
  'CREATE TABLE IF NOT EXISTS app_usage_daily',
  'CREATE TABLE IF NOT EXISTS management_rate_windows',
  'CREATE TABLE IF NOT EXISTS session_security_events',
]) {
  assert(migration.includes(token), `migration 031 is missing ${token}`);
}

for (const route of [
  'path="/account"',
  "'/admin'",
  "'/admin/users'",
  "'/admin/access'",
  "'/admin/sessions'",
  "'/admin/usage'",
  "'/admin/audit'",
  "'/admin/system'",
  'path="/reset-password"',
]) {
  assert(app.includes(route), `frontend route is missing ${route}`);
}
assert(app.includes('AdministrativePage'), 'admin routes are not authorization-gated');
assert(app.includes('access.canReadAdmin'), 'admin authorization is not derived from Worker management access');

assert(envSource.includes("CANONICAL_PRODUCTION_HOST = 'crypto-signal-bot-indol.vercel.app'"), 'canonical production host lock is missing');
assert(envSource.includes('configured && !isCanonicalProductionHost()'), 'canonical production must ignore demo identity');
assert(authContext.includes('requestPasswordReset'), 'password reset contract is missing');
assert(authContext.includes('updatePassword'), 'password update contract is missing');
assert(authProvider.includes('resetPasswordForEmail'), 'password recovery implementation is missing');
assert(authProvider.includes('updateUser({ password })'), 'password change implementation is missing');
assert(account.includes('Scoped access'), 'account access surface is missing');
assert(admin.includes('Administrative control plane'), 'admin management surface is missing');

assert(release.account_path === '/account', 'release manifest account_path is missing');
assert(release.admin_path === '/admin', 'release manifest admin_path is missing');
assert(release.management_api_path === '/v1/management', 'release manifest management API path is missing');
assert(release.canonical_demo_identity_enabled === false, 'canonical production demo identity must remain disabled');
assert(release.provider_mutation_enabled === false, 'provider mutation must remain disabled');
assert(release.live_trading_enabled === false, 'live trading must remain disabled');
assert(release.withdrawals_enabled === false, 'withdrawals must remain disabled');
assert(release.real_funds_enabled === false, 'real funds must remain disabled');

console.log('Usage-management contract verified: identity, lifecycle, scoped roles, admin/account surfaces, usage/audit evidence, rate limits, and paper/testnet safety are aligned.');
