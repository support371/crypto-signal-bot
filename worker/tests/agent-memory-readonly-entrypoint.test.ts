import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('deployed Worker entrypoint keeps agent memory read-only', async () => {
  const [entrypoint, wrangler] = await Promise.all([
    readFile(new URL('../src/index_agent_context.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../wrangler.toml', import.meta.url), 'utf8'),
  ])

  assert.match(wrangler, /main\s*=\s*"worker\/src\/index_agent_context\.ts"/)
  assert.match(entrypoint, /\/\^\\\/agent\\\/memory\\\/\[\^\/\]\+\$\/\.test\(url\.pathname\)/)
  assert.match(entrypoint, /request\.method !== 'GET'/)
  assert.match(entrypoint, /Agent memory is read-only in this deployment/)
  assert.match(entrypoint, /status:\s*405/)
  assert.match(entrypoint, /Allow:\s*'GET'/)
})
