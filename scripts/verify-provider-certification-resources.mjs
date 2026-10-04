import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { certificationStoreConfig, inspectCertificationStore } from './verify-bitget-secret-store-resources.mjs';

/** Fail before a deployment if this inspection-only service gains public or financial bindings. */
export function privateCertificationConfig(text) {
  const fields = [
    ['name','"crypto-signal-bot-provider-certification"'],
    ['main','"worker/src/index_provider_certification.ts"'],
    ['workers_dev','false'], ['preview_urls','false'],
    ['ALLOW_MAINNET','"false"'], ['LIVE_EXECUTION_ENABLED','"false"'], ['WITHDRAWALS_ENABLED','"false"'],
  ];
  for (const [name, expected] of fields) {
    const matches = [...text.matchAll(new RegExp(`^${name}\\s*=\\s*([^\\r\\n#]+)(?:#.*)?$`,'gm'))];
    if (matches.length !== 1 || matches[0][1].trim() !== expected) throw new Error('PRIVATE_CERTIFICATION_CONFIG_INVALID');
  }
  // Strip comments before checking assignment/table names, not credential values.
  const active = text.replace(/^\s*#.*$/gm,'');
  if (/^\s*routes\s*=|^\s*\[+\s*(?:routes|triggers|d1_databases|kv_namespaces|r2_buckets|durable_objects|services|queues)\b/m.test(active)
    || /BITGET_TRADE_|BITGET_WITHDRAW|^\s*CERTIFICATION_RUNNER_TOKEN\s*=/m.test(active)) {
    throw new Error('PRIVATE_CERTIFICATION_CONFIG_INVALID');
  }
  return certificationStoreConfig(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = privateCertificationConfig(await fs.readFile(new URL('../wrangler.provider-certification.toml',import.meta.url),'utf8'));
    const metadata = await inspectCertificationStore(config);
    console.log(JSON.stringify({ ...metadata, privateCertificationArtifactVerified: true,
      invocationTokenVerified: false, accountModelVerified: false, providerCertificationVerified: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
