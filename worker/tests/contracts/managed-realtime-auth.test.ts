import { afterEach, describe, expect, it, vi } from 'vitest'
import { authenticateManagedRead, type ManagementEnv } from '../../src/management'

afterEach(() => vi.unstubAllGlobals())
function fixture(status = 'ACTIVE') {
  const DB = { prepare(sql: string) { return { bind() { return {
    async run() { return {} },
    async first() { return { actor_id: 'verified-actor', status } },
    async all() { return { results: sql.includes('live_actor_roles') ? [{ role: 'VIEWER', scope_type: 'ACCOUNT',
      scope_key: 'account-a', expires_at: null, revoked_at: null }] : [] } },
  } } } } } as unknown as D1Database
  const env = { DB, SUPABASE_URL: 'https://identity.example', SUPABASE_PUBLISHABLE_KEY: 'public-project-key' } as ManagementEnv
  const request = new Request('https://worker.example/ws/updates', { headers: { Authorization: 'Bearer header.payload.signature' } })
  return { env, request }
}
describe('shared identity boundary for private realtime reads', () => {
  it('uses verified Supabase identity and database grants, ignoring user metadata roles', async () => {
    const f = fixture()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'verified-actor', user_metadata: { role: 'RELEASE_ADMIN' } })))
    expect(await authenticateManagedRead(f.request, f.env)).toEqual({ actorId: 'verified-actor',
      roles: [{ role: 'VIEWER', scopeType: 'ACCOUNT', scopeKey: 'account-a', expiresAt: null, revokedAt: null }] })
  })
  it('suspended profiles and invalid sessions cannot read private events', async () => {
    const f = fixture('SUSPENDED')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'verified-actor' })))
    expect(await authenticateManagedRead(f.request, f.env)).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid', { status: 401 })))
    expect(await authenticateManagedRead(f.request, f.env)).toBeNull()
  })
})
