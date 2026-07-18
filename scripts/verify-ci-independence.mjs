import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const workflowsRoot = path.join(root, '.github', 'workflows')
const circlePath = path.join(root, '.circleci', 'config.yml')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

const forbiddenTriggers = [
  'pull_request',
  'pull_request_target',
  'push',
  'schedule',
  'workflow_run',
  'repository_dispatch',
]

function topLevelOnBlock(source, filename) {
  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((line) => line === 'on:')
  if (start < 0) throw new Error(`${filename} must declare a top-level on block`)

  const block = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^[A-Za-z0-9_-]+:/.test(line)) break
    block.push(line)
  }
  return block.join('\n')
}

const workflowFiles = fs.readdirSync(workflowsRoot)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort()

if (workflowFiles.length === 0) {
  throw new Error('at least one GitHub workflow must remain available for manual diagnostics')
}

for (const filename of workflowFiles) {
  const source = fs.readFileSync(path.join(workflowsRoot, filename), 'utf8')
  const onBlock = topLevelOnBlock(source, filename)
  if (!/^  workflow_dispatch:\s*$/m.test(onBlock)) {
    throw new Error(`${filename} must remain explicitly manual through workflow_dispatch`)
  }
  for (const trigger of forbiddenTriggers) {
    if (new RegExp(`^  ${trigger}:`, 'm').test(onBlock)) {
      throw new Error(`${filename} must not automatically trigger on ${trigger}`)
    }
  }
}

const circle = fs.readFileSync(circlePath, 'utf8')
if (!circle.includes('image: cimg/node:22.12.0')) {
  throw new Error('CircleCI migration verification requires the pinned Node 22.12 runtime')
}
if (!packageJson.scripts?.build?.includes('verify:frontend-performance')) {
  throw new Error('frontend production build must enforce the performance budget')
}
const requiredCircleContracts = [
  'frontend-build:',
  'backend-test-audit:',
  'worker-live-foundation-tests:',
  'worker-provider-tests:',
  'worker-typecheck:',
  'worker-provider-typecheck:',
  'worker-paper-safety:',
  'worker-live-candidate-safety:',
  'worker-bitget-demo-write-transport-safety:',
  'worker-regulated-safety:',
  'worker-certification-safety:',
  'worker-cryptoops-operational-safety:',
  'worker-cryptoops-candidate-safety:',
  'worker-dry-run-bundles:',
  'worker-live-candidate-migrations:',
  'worker-recovery-accounting-fresh-dispatch-orchestrator-tests:',
  'ci-billing-independence:',
  'billing-independent-release-gate:',
]

for (const contract of requiredCircleContracts) {
  if (!circle.includes(contract)) {
    throw new Error(`CircleCI is missing required billing-independent contract ${contract}`)
  }
}
if (!circle.includes('node worker/scripts/verify-bitget-demo-rate-limit-authority-safety.mjs')) {
  throw new Error('CircleCI demo safety job must verify the Durable Object rate-limit authority')
}
if (!circle.includes('node worker/scripts/verify-bitget-demo-dispatch-evidence-safety.mjs')) {
  throw new Error('CircleCI demo safety job must verify immutable reviewed dispatch evidence')
}

const aggregateStart = circle.indexOf('      - billing-independent-release-gate:')
if (aggregateStart < 0) {
  throw new Error('CircleCI must invoke the billing-independent aggregate release gate')
}
const aggregate = circle.slice(aggregateStart)
const fastPathStart = circle.indexOf('      - worker-fast-path:')
const fastPathEnd = circle.indexOf('      - backend-test-audit', fastPathStart)
if (fastPathStart < 0 || fastPathEnd < 0) {
  throw new Error('CircleCI must invoke the aggregate Worker fast path')
}
const fastPath = circle.slice(fastPathStart, fastPathEnd)
if (!fastPath.includes('- worker-recovery-accounting-fresh-dispatch-orchestrator-tests')) {
  throw new Error('Worker fast path must require fresh-dispatch orchestration tests')
}
if (!fastPath.includes('- worker-safety-contracts')) {
  throw new Error('Worker fast path must require the aggregate safety contracts')
}
const safetyStart = circle.indexOf('      - worker-safety-contracts:')
const safetyEnd = circle.indexOf('      - worker-dry-run-bundles', safetyStart)
if (safetyStart < 0 || safetyEnd < 0) {
  throw new Error('CircleCI must invoke the aggregate Worker safety contracts')
}
const safetyContracts = circle.slice(safetyStart, safetyEnd)
if (!safetyContracts.includes('- worker-bitget-demo-write-transport-safety')) {
  throw new Error('Worker safety contracts must require Bitget demo write-transport isolation')
}

for (const dependency of [
  'frontend-build',
  'backend-test-audit',
  'worker-fast-path',
  'worker-live-candidate-migrations',
  'ci-billing-independence',
]) {
  if (!aggregate.includes(`- ${dependency}`)) {
    throw new Error(`aggregate release gate must require ${dependency}`)
  }
}

console.log(
  `CI billing independence verified (${workflowFiles.length} GitHub workflows are manual-only; CircleCI owns the aggregate gate).`,
)
