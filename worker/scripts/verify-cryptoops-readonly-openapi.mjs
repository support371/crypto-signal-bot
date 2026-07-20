import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const schemas = [
  'openapi/cryptoops-live-candidate-readonly.yaml',
  'openapi/cryptoops-withdrawals-candidate-readonly.yaml',
]
const failures = []

for (const relativePath of schemas) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
  const lower = content.toLowerCase()

  if (!/^openapi:\s*3\.1\.0/m.test(content)) {
    failures.push(`${relativePath}: OpenAPI 3.1.0 declaration is missing`)
  }
  for (const mutation of ['post:', 'put:', 'patch:', 'delete:']) {
    if (lower.includes(`\n    ${mutation}`) || lower.includes(`\n  ${mutation}`)) {
      failures.push(`${relativePath}: forbidden mutation operation ${mutation}`)
    }
  }
  if (!content.includes('type: apiKey') || !content.includes('name: X-API-Key')) {
    failures.push(`${relativePath}: server-side Action authentication declaration is missing`)
  }
  if (/(sk-proj-|api[_-]?key\s*:\s*['"][^'"]+|private[_-]?key\s*:\s*\|)/i.test(content)) {
    failures.push(`${relativePath}: secret-like content found`)
  }
  if (!content.includes('.example.invalid')) {
    failures.push(`${relativePath}: undeployed candidate must retain an invalid placeholder host`)
  }
  if (!content.includes('const: false')) {
    failures.push(`${relativePath}: disabled capability constants are missing`)
  }
}

if (failures.length > 0) {
  console.error('CryptoOps read-only OpenAPI verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('CryptoOps read-only OpenAPI verification passed.')
