import assert from 'node:assert/strict'
import test from 'node:test'
import { hasActiveGlobalReleaseAdmin } from '../src/management-bootstrap-guard.ts'

class FakeStatement {
  constructor(private readonly count: number | string | null) {}
  bind(_now: string) { return this }
  async first<T>(): Promise<T> {
    return { count: this.count } as T
  }
}

function env(count: number | string | null) {
  return {
    DB: {
      prepare(sql: string) {
        assert.match(sql, /role = 'RELEASE_ADMIN'/)
        assert.match(sql, /scope_type = 'GLOBAL'/)
        assert.match(sql, /revoked_at IS NULL/)
        return new FakeStatement(count)
      },
    } as unknown as D1Database,
  }
}

test('bootstrap remains open when no active global RELEASE_ADMIN exists', async () => {
  assert.equal(await hasActiveGlobalReleaseAdmin(env(0), '2026-09-05T00:00:00.000Z'), false)
})

test('bootstrap closes after the first active global RELEASE_ADMIN exists', async () => {
  assert.equal(await hasActiveGlobalReleaseAdmin(env(1), '2026-09-05T00:00:00.000Z'), true)
})

test('numeric strings from D1 are handled safely', async () => {
  assert.equal(await hasActiveGlobalReleaseAdmin(env('2'), '2026-09-05T00:00:00.000Z'), true)
})
