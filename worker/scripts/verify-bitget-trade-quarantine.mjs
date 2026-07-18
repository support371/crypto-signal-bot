import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

const config = read('wrangler.bitget-trade-quarantine.toml')
const entrypoint = read('worker/src/index_bitget_trade_quarantine.ts')
const certificationConfig = read('wrangler.live-candidate.toml')
const productionConfig = read('wrangler.toml')
const productionEntrypoint = read('worker/src/index.ts')
const failures = []
const secretBindingCount = config.match(/\[\[secrets_store_secrets\]\]/g)?.length ?? 0

if (secretBindingCount !== 3) {
  failures.push(`quarantine must declare exactly three trade bindings; found ${secretBindingCount}`)
}

for (const name of [
  'BITGET_TRADE_API_KEY',
  'BITGET_TRADE_API_SECRET',
  'BITGET_TRADE_API_PASSPHRASE',
]) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const binding = new RegExp(
    `\\[\\[secrets_store_secrets\\]\\][\\s\\S]{0,220}binding\\s*=\\s*"${escaped}"[\\s\\S]{0,220}secret_name\\s*=\\s*"${escaped}"`,
  )
  if (!binding.test(config)) failures.push(`missing exact quarantine binding for ${name}`)
}

for (const [token, message] of [
  ['main = "worker/src/index_bitget_trade_quarantine.ts"', 'quarantine entrypoint is not isolated'],
  ['workers_dev = false', 'workers.dev exposure must be disabled'],
  ['preview_urls = false', 'preview URL exposure must be disabled'],
  ['ALLOW_MAINNET = "false"', 'mainnet lock is missing'],
  ['LIVE_EXECUTION_ENABLED = "false"', 'execution lock is missing'],
  ['PROVIDER_MUTATION_ENABLED = "false"', 'provider mutation lock is missing'],
  ['TRADE_CREDENTIAL_ACCESS_ENABLED = "false"', 'credential-access lock is missing'],
  ['TRADE_TRANSPORT_CONFIGURED = "false"', 'transport lock is missing'],
  ['AUTOMATIC_RETRY_ENABLED = "false"', 'automatic-retry lock is missing'],
  ['WITHDRAWALS_ENABLED = "false"', 'withdrawal lock is missing'],
  ['RELEASE_AUTHORIZATION_PRESENT = "false"', 'release-authorization lock is missing'],
]) {
  if (!config.includes(token)) failures.push(message)
}

for (const pattern of [
  /BITGET_CERT_/,
  /BITGET_WITHDRAW/,
  /^routes\s*=/m,
  /\[\[routes\]\]/,
  /\[triggers\]/,
  /crons\s*=/,
  /\[\[d1_databases\]\]/,
  /\[\[r2_buckets\]\]/,
  /\[\[kv_namespaces\]\]/,
  /\[\[durable_objects\.bindings\]\]/,
  /\[\[queues\./,
  /=\s*"true"/,
]) {
  if (pattern.test(config)) failures.push(`forbidden quarantine configuration capability detected: ${pattern}`)
}

for (const pattern of [
  /BITGET_(?:TRADE|CERT|WITHDRAW)_/,
  /^\s*import\s/m,
  /SecretsStore/i,
  /\benv\b/,
  /fetch\s*\([^)]*,/,
  /\.get\s*\(/,
  /globalThis\.fetch/,
  /await\s+fetch\s*\(/,
  /crypto\.subtle/,
  /HMAC/i,
  /signature/i,
  /Authorization/i,
  /api\.bitget\.com/i,
  /\/api\/v\d+\/spot\/trade/i,
  /\.prepare\s*\(/,
  /\.put\s*\(/,
  /console\./,
  /providerMutationAllowed:\s*true/,
  /executionAllowed:\s*true/,
  /automaticRetryAllowed:\s*true/,
  /credentialAccessAllowed:\s*true/,
]) {
  if (pattern.test(entrypoint)) failures.push(`forbidden quarantine handler capability detected: ${pattern}`)
}

for (const token of [
  "status: 'TRADE_CREDENTIALS_QUARANTINED'",
  'credentialsValidated: false',
  'credentialAccessAllowed: false',
  'signingAllowed: false',
  'providerTransportConfigured: false',
  'providerMutationAllowed: false',
  'executionAllowed: false',
  'automaticRetryAllowed: false',
  'withdrawalsAllowed: false',
  'status: safeMethod ? 503 : 403',
]) {
  if (!entrypoint.includes(token)) failures.push(`quarantine handler is missing ${token}`)
}

for (const [name, content] of [
  ['read-only certification config', certificationConfig],
  ['paper production config', productionConfig],
  ['paper production entrypoint', productionEntrypoint],
]) {
  if (/BITGET_TRADE_/.test(content)) failures.push(`${name} must not reference trade bindings`)
}

if (failures.length > 0) {
  console.error('Bitget trade quarantine safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget trade quarantine safety verification passed.')
