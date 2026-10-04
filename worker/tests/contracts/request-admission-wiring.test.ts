import { beforeEach, describe, expect, it, vi } from 'vitest'

const delegate = vi.hoisted(() => ({ fetch: vi.fn(), scheduled: vi.fn() }))
vi.mock('../../src/index_agent_context', () => ({ default: delegate }))
import worker from '../../src/index_rate_limited'
import type { AgentContextEnv } from '../../src/agent-context'

function environment(count: number | null, fail = false) {
  const first = vi.fn(async () => { if (fail) throw new Error('private database details'); return count === null ? null : { count } })
  const run = vi.fn(async () => ({}))
  const DB = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first, run })) })) }
  return { DB, RATE_LIMIT_RPM: '2' } as unknown as AgentContextEnv
}

describe('canonical Worker admission wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delegate.fetch.mockResolvedValue(new Response('delegated'))
    delegate.scheduled.mockResolvedValue(undefined)
  })

  it.each(['/agent/context', '/v2/infrastructure/status', '/intent/paper', '/ws/updates', '/health'])('rejects %s before any inner route on D1 failure', async (path) => {
    const response = await worker.fetch(new Request(`https://worker.example${path}`), environment(null, true), {} as ExecutionContext)
    expect(response.status).toBe(503)
    expect(delegate.fetch).not.toHaveBeenCalled()
    expect(await response.text()).not.toContain('private')
  })

  it('does not delegate a rejected concurrent quota claim', async () => {
    const response = await worker.fetch(new Request('https://worker.example/health'), environment(null), {} as ExecutionContext)
    expect(response.status).toBe(429)
    expect(delegate.fetch).not.toHaveBeenCalled()
  })

  it('delegates an admitted request exactly once with its original context', async () => {
    const request = new Request('https://worker.example/health')
    const env = environment(1)
    const ctx = {} as ExecutionContext
    expect(await (await worker.fetch(request, env, ctx)).text()).toBe('delegated')
    expect(delegate.fetch).toHaveBeenCalledExactlyOnceWith(request, env, ctx)
  })

  it('awaits existing scheduled work and independently schedules bounded cleanup', async () => {
    const event = {} as ScheduledEvent
    const env = environment(1)
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext
    await worker.scheduled(event, env, ctx)
    expect(delegate.scheduled).toHaveBeenCalledExactlyOnceWith(event, env, ctx)
    expect(ctx.waitUntil).toHaveBeenCalledOnce()
  })

  it('wires recovery discovery into the five minute cron while retaining existing scheduled work', async () => {
    const event = { cron: '*/5 * * * *', scheduledTime: Date.now() } as ScheduledEvent
    const env = environment(1)
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext
    await worker.scheduled(event, env, ctx)
    expect(ctx.waitUntil).toHaveBeenCalledTimes(2)
    expect(delegate.scheduled).toHaveBeenCalledExactlyOnceWith(event, env, ctx)
  })
})
