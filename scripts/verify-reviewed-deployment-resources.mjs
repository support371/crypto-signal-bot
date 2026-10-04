import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { verifyWorkerDeploymentTarget } from './verify-worker-deployment-target.mjs';
import { certificationStoreConfig, inspectCertificationStore } from './verify-bitget-secret-store-resources.mjs';

const production = {
  db: '6046c4fd-87de-4b56-be9d-917d6994a86b',
  kv: '2dcb1050b9c846a7bba8cd1c3c43df62',
  bucket: 'crypto-signal-bot-storage',
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex = /^[a-f0-9]{32}$/;
const fail = (code) => { throw new Error(code); };
function field(text, key) {
  const matches = [...text.matchAll(new RegExp(`^${key}\\s*=\\s*"([^"\\r\\n]*)"\\s*(?:#.*)?$`, 'gm'))];
  if (matches.length !== 1) return fail('CANDIDATE_RESOURCE_CONFIG_AMBIGUOUS');
  return matches[0][1];
}

/** Read only the deliberately simple checked-in templates; unsupported syntax
 * fails closed. Wrangler remains the full TOML/config validator at bundle time. */
export function reviewedResourceConfig(candidateText, gatewayText) {
  const dbId = field(candidateText, 'database_id');
  const kvId = field(candidateText, 'id');
  const bucketName = field(candidateText, 'bucket_name');
  return { dbId, kvId, bucketName, gatewayDbId: field(gatewayText, 'database_id'),
    databaseName: field(candidateText, 'database_name'),
    gatewayDatabaseName: field(gatewayText, 'database_name'),
    gatewayWorker: field(gatewayText.split('[[d1_databases]]')[0], 'name'),
    candidateWorker: field(candidateText.split('[vars]')[0], 'name'),
    coordinatorWorker: field(gatewayText, 'script_name'),
    gatewayPrivate: field(gatewayText, 'main') === 'worker/src/index_reviewed_operations.ts'
      && /^workers_dev\s*=\s*false\s*$/m.test(gatewayText)
      && /^preview_urls\s*=\s*false\s*$/m.test(gatewayText)
      && !/^\s*(routes|route|crons)\s*=/m.test(gatewayText)
      && !/\[\[migrations\]\]|new_sqlite_classes/.test(gatewayText),
  };
}

export function reviewedCoordinatorConfig(coordinatorText, gatewayText) {
  return { profile: 'PROJECTION_ONLY', dbId: field(coordinatorText,'database_id'),
    gatewayDbId: field(gatewayText,'database_id'), databaseName: field(coordinatorText,'database_name'),
    gatewayDatabaseName: field(gatewayText,'database_name'),
    gatewayWorker: field(gatewayText.split('[[d1_databases]]')[0],'name'),
    candidateWorker: field(coordinatorText.split('[vars]')[0],'name'),
    coordinatorWorker: field(gatewayText,'script_name'),
    gatewayPrivate: field(gatewayText,'main') === 'worker/src/index_reviewed_operations.ts'
      && field(coordinatorText,'main') === 'worker/src/index_reviewed_coordinator.ts'
      && [coordinatorText,gatewayText].every((text)=> /^workers_dev\s*=\s*false\s*$/m.test(text)
        && /^preview_urls\s*=\s*false\s*$/m.test(text) && !/^\s*(routes|route|crons)\s*=/m.test(text)),
  };
}

export function validateReviewedResourceIsolation(config) {
  if (!uuid.test(config.dbId) || config.dbId === '00000000-0000-0000-0000-000000000000'
    || config.profile && config.profile !== 'PROJECTION_ONLY'
    || config.profile !== 'PROJECTION_ONLY' && (!hex.test(config.kvId) || /^0+$/.test(config.kvId)
      || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.bucketName))) return fail('CANDIDATE_RESOURCES_NOT_CONFIGURED');
  if (config.dbId === production.db || config.kvId === production.kv || config.bucketName === production.bucket) {
    return fail('CANDIDATE_PRODUCTION_RESOURCE_REUSE_DENIED');
  }
  if (config.dbId !== config.gatewayDbId || config.databaseName !== config.gatewayDatabaseName
    || config.databaseName !== 'crypto-signal-bot-live-candidate-db'
    || config.candidateWorker !== 'crypto-signal-bot-live-candidate'
    || config.coordinatorWorker !== config.candidateWorker || !config.gatewayPrivate) {
    return fail('REVIEWED_COORDINATOR_CONFIG_MISMATCH');
  }
  return config;
}

export async function inspectReviewedDeploymentResources(config, { environment = process.env,
  fetcher = fetch, requireCoordinator = false, requireGateway = false } = {}) {
  const account = verifyWorkerDeploymentTarget(environment);
  validateReviewedResourceIsolation(config);
  if (requireGateway) {
    requireCoordinator = true;
    if (config.gatewayWorker !== 'crypto-signal-bot-reviewed-operations') return fail('REVIEWED_GATEWAY_CONFIG_MISMATCH');
  }
  const token = environment.CLOUDFLARE_API_TOKEN;
  if (typeof token !== 'string' || !token.trim()) return fail('CLOUDFLARE_RESOURCE_INSPECTION_AUTH_REQUIRED');
  const get = async (path) => {
    const signal = AbortSignal.timeout(10_000);
    try {
      const result = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal,
      });
      if (!result.ok) return fail('CLOUDFLARE_RESOURCE_INSPECTION_UNAVAILABLE');
      const reader = result.body?.getReader();
      if (!reader) return fail('CLOUDFLARE_RESOURCE_INSPECTION_UNAVAILABLE');
      let bytes = 0; const chunks = [];
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 131_072) { await reader.cancel().catch(() => {}); return fail('CLOUDFLARE_RESOURCE_RESPONSE_LIMIT'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const body = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const parsed = JSON.parse(new TextDecoder().decode(body));
      if (parsed.success !== true || !parsed.result) return fail('CLOUDFLARE_RESOURCE_INSPECTION_UNAVAILABLE');
      return parsed.result;
    } catch { return fail('CLOUDFLARE_RESOURCE_INSPECTION_UNAVAILABLE'); }
  };
  const results = await Promise.allSettled([
    get(`d1/database/${config.dbId}`),
    ...(config.profile === 'PROJECTION_ONLY' ? [] : [get('storage/kv/namespaces?per_page=100'),
      get(`r2/buckets/${encodeURIComponent(config.bucketName)}`)]),
    ...(requireCoordinator ? [get(`workers/scripts/${config.candidateWorker}/settings`)] : []),
    ...(requireGateway ? [get(`workers/scripts/${config.gatewayWorker}/settings`),
      get(`workers/scripts/${config.candidateWorker}/subdomain`),
      get(`workers/scripts/${config.gatewayWorker}/subdomain`)] : []),
  ]);
  if (results.some((r) => r.status !== 'fulfilled')) return fail('CLOUDFLARE_RESOURCE_INSPECTION_UNAVAILABLE');
  const values = results.map((r) => r.value);
  const db = values[0];
  const namespaces = values[1]; const bucket = values[2];
  const worker = values[config.profile === 'PROJECTION_ONLY' ? 1 : 3];
  const kv = Array.isArray(namespaces) ? namespaces.find((n) => n.id === config.kvId) : null;
  if (db.uuid !== config.dbId || db.name !== config.databaseName || config.profile !== 'PROJECTION_ONLY' && (kv?.id !== config.kvId
    || bucket?.name !== config.bucketName)) return fail('CANDIDATE_ACCOUNT_RESOURCE_MISMATCH');
  if (requireCoordinator) {
    const bindings = worker.bindings ?? [];
    const coordinator = bindings.find((b) => b.name === 'EXCHANGE_ACCOUNT_COORDINATOR');
    if (!coordinator || coordinator.type !== 'durable_object_namespace'
      || coordinator.class_name !== 'ExchangeAccountCoordinator' || !coordinator.namespace_id
      || coordinator.script_name && coordinator.script_name !== config.candidateWorker
      || !bindings.some((b) => b.name === 'DB' && b.type === 'd1' && b.id === config.dbId)) {
      return fail('DEPLOYED_COORDINATOR_BINDING_UNVERIFIED');
    }
  }
  let operatorCredentialBindingConfigured = false;
  if (requireGateway) {
    const index = config.profile === 'PROJECTION_ONLY' ? 2 : 4;
    const gateway = values[index]; const candidateUrls = values[index+1]; const gatewayUrls = values[index+2];
    const coordinator = worker.bindings.find((b)=>b.name === 'EXCHANGE_ACCOUNT_COORDINATOR');
    const bindings = gateway.bindings ?? [];
    const imported = bindings.find((b)=>b.name === 'EXCHANGE_ACCOUNT_COORDINATOR');
    const secretBound = (bindings,name)=>bindings.some((b)=>b.name === name && b.type === 'secret_text');
    if (!imported || imported.type !== 'durable_object_namespace'
      || imported.class_name !== 'ExchangeAccountCoordinator'
      || imported.script_name !== config.candidateWorker
      || imported.namespace_id !== coordinator.namespace_id
      || !bindings.some((b)=>b.name === 'DB' && b.type === 'd1' && b.id === config.dbId)
      || !secretBound(bindings,'CANDIDATE_ACCOUNTING_TOKEN')
      || !secretBound(worker.bindings,'CANDIDATE_ACCOUNTING_TOKEN')) return fail('DEPLOYED_GATEWAY_BINDINGS_UNVERIFIED');
    if ([candidateUrls,gatewayUrls].some((s)=>s.enabled !== false || s.previews_enabled !== false)) {
      return fail('DEPLOYED_PRIVATE_URLS_UNVERIFIED');
    }
    operatorCredentialBindingConfigured = secretBound(bindings,'OPERATOR_API_KEY_HASHES');
  }
  return Object.freeze({ status: 'RESOURCE_METADATA_VERIFIED', accountId: account,
    resourceProfile: config.profile ?? 'FULL_CANDIDATE', deployedCoordinator: requireCoordinator,
    ...(requireGateway ? { deployedGatewayBindingsVerified:true, publicUrlsDisabled:true,
      internalCredentialBindingsVerified:true, operatorCredentialBindingConfigured } : {}),
    providerCertificationVerified: false, mainnetActivationVerified: false });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const root = new URL('../', import.meta.url);
    const projection = process.argv.includes('--projection');
    const [candidate, gateway] = await Promise.all([
      fs.readFile(new URL(projection ? 'wrangler.reviewed-coordinator.toml' : 'wrangler.live-candidate.toml', root), 'utf8'),
      fs.readFile(new URL('wrangler.reviewed-operations.toml', root), 'utf8'),
    ]);
    const result = await inspectReviewedDeploymentResources(projection ? reviewedCoordinatorConfig(candidate, gateway)
      : reviewedResourceConfig(candidate, gateway), {
      requireCoordinator: process.argv.includes('--require-coordinator'),
      requireGateway: process.argv.includes('--require-gateway'),
    });
    if (!projection) await inspectCertificationStore(certificationStoreConfig(candidate));
    console.log(JSON.stringify({ ...result, ...(!projection ? { providerSecretMetadataVerified: true } : {}) }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
