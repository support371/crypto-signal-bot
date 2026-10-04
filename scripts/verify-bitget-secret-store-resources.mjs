import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { verifyWorkerDeploymentTarget } from './verify-worker-deployment-target.mjs';

const names = Object.freeze(['BITGET_CERT_API_KEY', 'BITGET_CERT_API_SECRET', 'BITGET_CERT_API_PASSPHRASE']);
const safeErrors = new Set(['PROVIDER_SECRET_METADATA_TIMEOUT', 'PROVIDER_SECRET_STORE_NOT_FOUND',
  'PROVIDER_SECRET_METADATA_ACCESS_DENIED', 'PROVIDER_SECRET_METADATA_UNAVAILABLE',
  'PROVIDER_SECRET_METADATA_OVERSIZED', 'PROVIDER_SECRET_METADATA_INVALID']);
const fail = (code) => { throw new Error(code); };

export function certificationStoreConfig(text) {
  const blocks = [...text.matchAll(/^\[\[secrets_store_secrets\]\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)].map(m => m[1]);
  const field = (block, name) => {
    const matches = [...block.matchAll(new RegExp(`^${name}\\s*=\\s*"([^"\\r\\n]*)"\\s*(?:#.*)?$`, 'gm'))];
    if (matches.length !== 1) fail('PROVIDER_SECRET_CONFIG_INVALID');
    return matches[0][1];
  };
  if (blocks.length !== names.length) fail('PROVIDER_SECRET_CONFIG_INVALID');
  const bindings = blocks.map(block => ({ binding: field(block, 'binding'), storeId: field(block, 'store_id'), secretName: field(block, 'secret_name') }));
  if (names.some(name => bindings.filter(b => b.binding === name && b.secretName === name).length !== 1)
    || bindings.some(b => !/^[a-f0-9]{32}$/.test(b.storeId) || /^0+$/.test(b.storeId))
    || new Set(bindings.map(b => b.storeId)).size !== 1) fail('PROVIDER_SECRET_CONFIG_INVALID');
  return Object.freeze({ storeId: bindings[0].storeId, secretNames: names });
}

/** Metadata only: never retrieve values, modify resources or claim provider certification. */
export async function inspectCertificationStore(config, { environment = process.env, fetcher = fetch, timeoutMs = 10_000 } = {}) {
  const account = verifyWorkerDeploymentTarget(environment);
  if (!/^[a-f0-9]{32}$/.test(config?.storeId) || /^0+$/.test(config.storeId)
    || !Array.isArray(config.secretNames) || config.secretNames.length !== 3
    || names.some(n => !config.secretNames.includes(n))) fail('PROVIDER_SECRET_CONFIG_INVALID');
  if (typeof environment.CLOUDFLARE_API_TOKEN !== 'string' || !environment.CLOUDFLARE_API_TOKEN.trim()) fail('PROVIDER_SECRET_METADATA_AUTH_REQUIRED');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) fail('PROVIDER_SECRET_METADATA_TIMEOUT_INVALID');
  const observed = new Map();
  for (let page = 1; page <= 20; page++) {
    const controller = new AbortController(); let reader; let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(); void reader?.cancel().catch(() => {});
        reject(new Error('PROVIDER_SECRET_METADATA_TIMEOUT'));
      }, timeoutMs);
    });
    const collect = async () => {
      const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/secrets_store/stores/${config.storeId}/secrets?page=${page}&per_page=100`, {
        method: 'GET', headers: { Authorization: `Bearer ${environment.CLOUDFLARE_API_TOKEN}` }, signal: controller.signal,
      });
      if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); fail('PROVIDER_SECRET_METADATA_TIMEOUT'); }
      if (response.status === 404) fail('PROVIDER_SECRET_STORE_NOT_FOUND');
      if (response.status === 401 || response.status === 403) fail('PROVIDER_SECRET_METADATA_ACCESS_DENIED');
      if (!response.ok || !response.body) fail('PROVIDER_SECRET_METADATA_UNAVAILABLE');
      reader = response.body.getReader(); let bytes = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 131_072) { void reader.cancel().catch(() => {}); fail('PROVIDER_SECRET_METADATA_OVERSIZED'); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const data = new Uint8Array(bytes); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      let body;
      try { body = JSON.parse(new TextDecoder().decode(data)); } catch { fail('PROVIDER_SECRET_METADATA_INVALID'); }
      if (body.success !== true || !Array.isArray(body.result) || body.result.length > 100) fail('PROVIDER_SECRET_METADATA_INVALID');
      return body;
    };
    let body;
    try { body = await Promise.race([collect(), deadline]); }
    catch (error) {
      if (safeErrors.has(error?.message)) throw new Error(error.message);
      fail('PROVIDER_SECRET_METADATA_UNAVAILABLE');
    } finally { clearTimeout(timer); }
    for (const secret of body.result) {
      if (!names.includes(secret?.name)) continue;
      if (observed.has(secret.name)) fail('PROVIDER_SECRET_METADATA_DUPLICATE');
      if (!Array.isArray(secret.scopes) || !secret.scopes.includes('workers')) fail('PROVIDER_SECRET_WORKER_SCOPE_MISSING');
      observed.set(secret.name, true);
    }
    const info = body.result_info;
    if (info && (!Number.isSafeInteger(info.total_count) || info.total_count < 0
      || info.page !== page || info.per_page !== 100)) fail('PROVIDER_SECRET_PAGINATION_INVALID');
    const complete = info ? page * 100 >= info.total_count : body.result.length < 100;
    if (complete) {
      if (names.some(n => !observed.has(n))) fail('PROVIDER_CERTIFICATION_SECRET_MISSING');
      return Object.freeze({ status: 'SECRET_METADATA_VERIFIED', accountId: account, storeId: config.storeId,
        bindingNames: names, secretValuesRead: false, providerCertificationVerified: false, mainnetActivationVerified: false });
    }
  }
  fail('PROVIDER_SECRET_PAGINATION_LIMIT');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const text = await fs.readFile(new URL('../wrangler.live-candidate.toml', import.meta.url), 'utf8');
    console.log(JSON.stringify(await inspectCertificationStore(certificationStoreConfig(text))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
