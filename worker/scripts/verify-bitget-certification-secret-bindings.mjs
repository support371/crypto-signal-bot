import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const config = fs.readFileSync(path.join(repoRoot, 'wrangler.live-candidate.toml'), 'utf8')
const provider = fs.readFileSync(
  path.join(repoRoot, 'worker/src/live/adapters/bitget/certification-secret-provider.ts'),
  'utf8',
)
const entrypoint = fs.readFileSync(path.join(repoRoot, 'worker/src/index_live_candidate.ts'), 'utf8')
const failures = []

for (const name of [
  'BITGET_CERT_API_KEY',
  'BITGET_CERT_API_SECRET',
  'BITGET_CERT_API_PASSPHRASE',
]) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const binding = new RegExp(
    `\\[\\[secrets_store_secrets\\]\\][\\s\\S]{0,220}binding\\s*=\\s*"${escaped}"[\\s\\S]{0,220}secret_name\\s*=\\s*"${escaped}"`,
  )
  if (!binding.test(config)) failures.push(`missing exact Secrets Store binding for ${name}`)
  if (!provider.includes(`this.#env.${name}`)) failures.push(`provider does not read ${name}`)
}

for (const token of [
  'BitgetCertificationSecretsStoreProvider',
  'Promise.all',
  '.get()',
  'Object.freeze',
  'BITGET_CERTIFICATION_SECRET_UNAVAILABLE',
]) {
  if (!provider.includes(token)) failures.push(`certification secret provider is missing ${token}`)
}

for (const pattern of [
  /BITGET_TRADE_/,
  /BITGET_WITHDRAW/,
  /console\./,
  /JSON\.stringify/,
  /fetch\(/,
  /\.put\(/,
  /\.prepare\(/,
  /credentialsPersisted:\s*true/,
]) {
  if (provider.match(pattern) || config.match(pattern)) {
    failures.push(`forbidden certification-secret capability detected: ${pattern}`)
  }
}

if (entrypoint.includes('certification-secret-provider')) {
  failures.push('public candidate entrypoint must not load certification secrets')
}

if (failures.length > 0) {
  console.error('Bitget certification secret-binding safety verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Bitget certification secret-binding safety verification passed.')
