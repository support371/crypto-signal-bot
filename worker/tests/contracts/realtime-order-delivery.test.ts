import { describe, expect, it, vi } from 'vitest'
import { createRealtimeOrderDelivery, type RealtimeReadPrincipal } from '../../src/routes/realtime-order-events'
import type { ManagementEnv } from '../../src/management'

const principal: RealtimeReadPrincipal = { actorId: 'actor-1', roles: [] }
const frame = { access_token: 'header.payload.signature', after_sequence: 0 }
const event = { type: 'order_state' as const, sequence_id: 1, event_id: 'event-1', order_id: 'order-1', account_id: 'account-1',
  previous_state: null, state: 'OPEN', source: 'exchange-rest', occurred_at: '2026-10-04T00:00:00.000Z',
  evidence_hash: 'a'.repeat(64), audit_hash: 'b'.repeat(64) }
function fixture() {
  const send = vi.fn()
  const authorize = vi.fn(async () => principal as RealtimeReadPrincipal | null)
  const read = vi.fn(async (_DB, _principal, after: number) => after === 0 ? [event] : [])
  const stream = createRealtimeOrderDelivery(new Request('https://worker.example/ws/updates'), { DB: {} } as ManagementEnv,
    send, { authorize, read })
  return { send, authorize, read, stream }
}

describe('private realtime order delivery', () => {
  it('never reads private events before authenticated frames', async () => {
    const f = fixture()
    await f.stream.refresh()
    expect(f.authorize).not.toHaveBeenCalled()
    expect(f.read).not.toHaveBeenCalled()
  })
  it('verifies the session before each batch and does not send or place tokens in URLs', async () => {
    const f = fixture()
    await f.stream.authenticate(frame)
    await f.stream.refresh()
    expect(f.authorize).toHaveBeenCalledTimes(2)
    const request = f.authorize.mock.calls[0][0] as Request
    expect(request.headers.get('Authorization')).toBe(`Bearer ${frame.access_token}`)
    expect(request.url).not.toContain(frame.access_token)
    expect(f.read.mock.calls[1][2]).toBe(1)
    expect(JSON.stringify(f.send.mock.calls)).not.toContain(frame.access_token)
    expect(f.send.mock.calls.filter(([item]) => item.type === 'order_state')).toHaveLength(1)
  })
  it('expired/revoked identity and storage failure disclose no further private events', async () => {
    const f = fixture()
    f.authorize.mockResolvedValue(null)
    await f.stream.authenticate(frame)
    expect(f.read).not.toHaveBeenCalled()
    expect(f.send).toHaveBeenLastCalledWith({ type: 'order_stream_status', authenticated: false, code: 'ORDER_READ_UNAVAILABLE' })
    f.authorize.mockResolvedValue(principal)
    f.read.mockRejectedValue(new Error('secret database details'))
    await f.stream.authenticate(frame)
    expect(JSON.stringify(f.send.mock.calls)).not.toContain('secret')
  })
  it('disconnect during a pending read prevents late disclosure', async () => {
    const f = fixture()
    let resolve!: (value: typeof event[]) => void
    f.read.mockImplementation(() => new Promise((done) => { resolve = done }))
    const pending = f.stream.authenticate(frame)
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
    f.stream.close()
    resolve([event])
    await pending
    expect(f.send).not.toHaveBeenCalled()
  })
  it('new authentication invalidates an outstanding prior-identity read', async () => {
    const f = fixture()
    let resolve!: (value: typeof event[]) => void
    f.read.mockImplementationOnce(() => new Promise((done) => { resolve = done })).mockResolvedValue([])
    const pending = f.stream.authenticate(frame)
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
    await f.stream.authenticate({ ...frame, access_token: 'other.payload.signature' })
    resolve([event])
    await pending
    await vi.waitFor(() => expect(f.authorize).toHaveBeenCalledTimes(2))
    expect(f.send.mock.calls.some(([item]) => item.type === 'order_state')).toBe(false)
  })
  it('rejects malformed credentials and cursors before identity requests', async () => {
    const f = fixture()
    for (const value of [{ ...frame, access_token: 'demo-paper-token' }, { ...frame, after_sequence: -1 }, null]) {
      await f.stream.authenticate(value)
    }
    expect(f.authorize).not.toHaveBeenCalled()
  })
  it('a stalled identity dependency cannot leave private delivery armed', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture()
      f.authorize.mockReturnValue(new Promise(() => {}))
      const pending = f.stream.authenticate(frame)
      await vi.advanceTimersByTimeAsync(8000)
      await pending
      expect(f.read).not.toHaveBeenCalled()
      expect(f.send).toHaveBeenLastCalledWith({ type: 'order_stream_status', authenticated: false, code: 'ORDER_READ_UNAVAILABLE' })
      await f.stream.refresh()
      expect(f.authorize).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
})
