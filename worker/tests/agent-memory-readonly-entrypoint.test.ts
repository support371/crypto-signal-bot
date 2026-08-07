import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

test('deployed Worker entrypoint keeps agent memory read-only and browser-readable', async () => {
  const [entrypoint, wrangler] = await Promise.all([
    readFile(new URL('../src/index_agent_context.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../wrangler.toml', import.meta.url), 'utf8'),
  ])

  assert.match(wrangler, /main\s*=\s*"worker\/src\/index_agent_context\.ts"/)
  assert.match(entrypoint, /\/\^\\\/agent\\\/memory\\\/\[\^\/\]\+\$\/\.test\(url\.pathname\)/)
  assert.match(entrypoint, /request\.method === 'OPTIONS'/)
  assert.match(entrypoint, /status:\s*204/)
  assert.match(entrypoint, /Access-Control-Allow-Methods': 'GET, OPTIONS'/)
  assert.match(entrypoint, /request\.method !== 'GET'/)
  assert.match(entrypoint, /Agent memory is read-only in this deployment/)
  assert.match(entrypoint, /status:\s*405/)
  assert.match(entrypoint, /headers\.set\('Allow', 'GET, OPTIONS'\)/)
  assert.match(entrypoint, /const response = await worker\.fetch\(request, env, ctx\)/)
  assert.match(entrypoint, /agentMemoryCorsHeaders\(request, env\)/)
})

test('agent memory CORS does not authorize an unlisted browser origin', async () => {
  const entrypoint = await readFile(
    new URL('../src/index_agent_context.ts', import.meta.url),
    'utf8',
  )

  assert.match(entrypoint, /const origin = request\.headers\.get\('Origin'\)/)
  assert.match(entrypoint, /configured\.includes\('\*'\)/)
  assert.match(entrypoint, /origin && configured\.includes\(origin\)/)
  assert.doesNotMatch(entrypoint, /configured\[0\]/)
})
