import { beforeEach, describe, expect, it, vi } from 'vitest'
const jobs = vi.hoisted(() => ({ discovery: vi.fn(), read: vi.fn(), scheduled: vi.fn() }))
vi.mock('../../src/live/scheduled-recovery-discovery', () => ({ discoverScheduledRecovery: jobs.discovery }))
vi.mock('../../src/live/scheduled-recovery-read', () => ({ consumeScheduledRecoveryReads: jobs.read }))
vi.mock('../../src/index_agent_context', () => ({ default: { scheduled: jobs.scheduled } }))
import worker from '../../src/index_rate_limited'
import type { AgentContextEnv } from '../../src/agent-context'

describe('canonical scheduled recovery composition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    jobs.discovery.mockResolvedValue({ status: 'DISABLED' })
    jobs.read.mockResolvedValue({ status: 'DISABLED' })
    jobs.scheduled.mockResolvedValue(undefined)
  })
  function context() {
    const promises: Promise<unknown>[] = []
    const env = { DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } } as unknown as AgentContextEnv
    const ctx = { waitUntil: (promise: Promise<unknown>) => { promises.push(promise) } } as unknown as ExecutionContext
    return { env, ctx, promises }
  }
  it('awaits discovery before reads and retains the legacy schedule', async () => {
    const { env, ctx, promises } = context()
    let release!: () => void
    jobs.discovery.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    const event = { cron: '*/5 * * * *', scheduledTime: 12345 } as ScheduledEvent
    await worker.scheduled(event, env, ctx)
    expect(jobs.read).not.toHaveBeenCalled()
    release()
    await Promise.all(promises)
    expect(jobs.read).toHaveBeenCalledOnce()
    expect(jobs.read.mock.calls[0][0]).toBe(env)
    expect(jobs.read.mock.calls[0][1]).toBeGreaterThan(event.scheduledTime)
    expect(jobs.scheduled).toHaveBeenCalledExactlyOnceWith(event, env, ctx)
  })
  it('discovery failure blocks provider consumption', async () => {
    const { env, ctx, promises } = context()
    jobs.discovery.mockRejectedValue(new Error('unverified account'))
    await worker.scheduled({ cron: '*/5 * * * *', scheduledTime: Date.now() } as ScheduledEvent, env, ctx)
    const outcomes = await Promise.allSettled(promises)
    expect(outcomes.some((result) => result.status === 'rejected')).toBe(true)
    expect(jobs.read).not.toHaveBeenCalled()
  })
  it('other schedules do not invoke recovery reads', async () => {
    const { env, ctx, promises } = context()
    await worker.scheduled({ cron: '0 * * * *' } as ScheduledEvent, env, ctx)
    await Promise.all(promises)
    expect(jobs.discovery).not.toHaveBeenCalled()
    expect(jobs.read).not.toHaveBeenCalled()
  })
})
