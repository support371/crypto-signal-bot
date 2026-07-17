import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const actionRoot = path.join(repoRoot, 'gpt-actions', 'url')

const requiredFiles = [
  'CRYPTOOPS_GPT_MASTER_INSTRUCTIONS.md',
  'cryptoops-worker-readonly.yaml',
  'cryptoops-github-readonly.yaml',
  'cryptoops-cloudflare-readonly.yaml',
  'privacy-policy.html',
]

const failures = []

function read(name) {
  const target = path.join(actionRoot, name)
  if (!fs.existsSync(target)) {
    failures.push(`missing required CryptoOps file: ${name}`)
    return ''
  }
  return fs.readFileSync(target, 'utf8')
}

for (const name of requiredFiles) read(name)

const yamlFiles = fs.existsSync(actionRoot)
  ? fs.readdirSync(actionRoot).filter((name) => name.endsWith('.yaml'))
  : []

if (yamlFiles.length < 3) {
  failures.push('at least three read-only OpenAPI schemas are required')
}

const forbiddenMethod = /^\s{4}(post|put|patch|delete|trace):\s*$/gim
const forbiddenOperation = /^\s+operationId:\s*(create|submit|place|cancel|replace|approve|reject|reset|trigger|halt|deploy|promote|rollback|update|delete|write|withdraw|transfer)/gim
const forbiddenCredential = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|CF_API_TOKEN\s*=|CLOUDFLARE_API_TOKEN\s*=|VERCEL_TOKEN\s*=|EXCHANGE_API_KEY\s*=)/i

for (const name of yamlFiles) {
  const content = read(name)
  if (!/^openapi:\s*3\.1\.0\s*$/m.test(content)) {
    failures.push(`${name}: OpenAPI version must be 3.1.0`)
  }
  if (forbiddenMethod.test(content)) {
    failures.push(`${name}: contains a non-read-only HTTP method`)
  }
  forbiddenMethod.lastIndex = 0
  if (forbiddenOperation.test(content)) {
    failures.push(`${name}: contains a mutation-like operationId`)
  }
  forbiddenOperation.lastIndex = 0
  if (/^\s+requestBody:\s*$/m.test(content)) {
    failures.push(`${name}: requestBody is forbidden in read-only Actions`)
  }
  if (forbiddenCredential.test(content)) {
    failures.push(`${name}: contains a credential-like literal`)
  }
}

const instructions = read('CRYPTOOPS_GPT_MASTER_INSTRUCTIONS.md')
for (const phrase of [
  'read-only',
  'Never place an order',
  'Do not write directly to `main`',
  'LIVE-CODE READY BUT LOCKED',
]) {
  if (!instructions.includes(phrase)) {
    failures.push(`master instructions missing required boundary: ${phrase}`)
  }
}

const privacy = read('privacy-policy.html')
for (const phrase of [
  'read-only operational visibility',
  'must not place or cancel orders',
  'Credentials must not be placed',
]) {
  if (!privacy.includes(phrase)) {
    failures.push(`privacy policy missing required statement: ${phrase}`)
  }
}

if (failures.length > 0) {
  console.error('CryptoOps read-only Action verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`CryptoOps read-only Action verification passed for ${yamlFiles.length} schema(s).`)
