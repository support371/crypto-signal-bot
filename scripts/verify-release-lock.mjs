import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
}).split('\0').filter(Boolean)

const forbiddenBasenames = new Set([
  '.env',
  '.env.production',
  '.env.staging',
  '.env.preview',
  '.dev.vars',
])
const forbiddenExtensions = new Set(['.pem', '.key', '.p12', '.pfx'])

const forbidden = tracked.filter((filename) => {
  const basename = path.basename(filename)
  return forbiddenBasenames.has(basename)
    || forbiddenExtensions.has(path.extname(filename).toLowerCase())
})

if (forbidden.length > 0) {
  throw new Error(`committed runtime secret files are forbidden: ${forbidden.join(', ')}`)
}

for (const required of [
  'docs/PRODUCTION_LOCK.md',
  'wrangler.live-candidate.toml',
  'wrangler.withdrawals-candidate.toml',
]) {
  if (!fs.existsSync(path.join(root, required))) {
    throw new Error(`required release-lock artifact is missing: ${required}`)
  }
}

const liveConfig = fs.readFileSync(path.join(root, 'wrangler.live-candidate.toml'), 'utf8')
const withdrawalConfig = fs.readFileSync(
  path.join(root, 'wrangler.withdrawals-candidate.toml'),
  'utf8',
)

for (const invariant of [
  'ALLOW_MAINNET = "false"',
  'LIVE_EXECUTION_ENABLED = "false"',
  'WITHDRAWALS_ENABLED = "false"',
]) {
  if (!liveConfig.includes(invariant)) {
    throw new Error(`live candidate release lock is missing ${invariant}`)
  }
}
if (!withdrawalConfig.includes('WITHDRAWALS_ENABLED = "false"')) {
  throw new Error('withdrawal candidate release lock must remain disabled')
}

console.log('Release lock verified without GitHub Actions or secret-bearing dependencies.')
