import assert from 'node:assert/strict'
import test from 'node:test'

import { scanLiveOrdersForRecovery } from '../src/live/recovery-scan.ts'

function fakeEnv(rows: unknown[]) {
  const capture: { sql: string; bindings: unknown[] } = { sql: '', bindings: [] }
  const DB = {
    prepare(sql: string) {
      capture.sql = sql
      return {
        bind(...bindings: unknown[]) {
          capture.bindings = bindings
          return {
            async all() {
              return { results: rows }
            },
          }
        },
      }
    },
  } as unknown as D1Database

  return { env: { DB }, capture }
}

test('recovery scan is read-only and selects explicit plus stale exchange-active orders', async () => {
  const { env, capture } = fakeEnv([
    {
      internal_order_id: 'order-recovery-1',
      exchange_account_id: 'acct-1',
      exchange_order_id: null,
      client_order_id: 'client-1',
      product_id: 'BTC-USDT',
      state: 'RECOVERY_REQUIRED',
      updated_at: '2026-09-29T07:00:00.000Z',
    },
    {
      internal_order_id: 'order-stale-1',
      exchange_account_id: 'acct-1',
      exchange_order_id: 'exchange-1',
      client_order_id: 'client-2',
      product_id: 'BTC-USDT',
      state: 'SUBMITTED',
      updated_at: '2026-09-29T07:30:00.000Z',
    },
  ])

  const rows = await scanLiveOrdersForRecovery(env, {
    staleBefore: '2026-09-29T07:45:00.000Z',
    limit: 25,
  })

  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.recoveryReason, 'EXPLICIT_RECOVERY_REQUIRED')
  assert.equal(rows[1]?.recoveryReason, 'STALE_EXCHANGE_ACTIVE_ORDER')
  assert.match(capture.sql, /^SELECT /)
  assert.doesNotMatch(capture.sql, /\b(?:INSERT|UPDATE|DELETE)\b/i)
  assert.ok(capture.sql.includes("state = 'RECOVERY_REQUIRED'"))
  for (const state of ['SUBMITTING', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'CANCEL_REQUESTED', 'CANCEL_PENDING']) {
    assert.ok(capture.bindings.includes(state), `missing recovery-active state: ${state}`)
  }
  assert.deepEqual(capture.bindings.slice(-2), [
    '2026-09-29T07:45:00.000Z',
    25,
  ])
})

test('recovery scan validates cutoff and bounds work per invocation', async () => {
  const { env } = fakeEnv([])

  await assert.rejects(
    scanLiveOrdersForRecovery(env, { staleBefore: 'not-a-date' }),
    /staleBefore must be ISO-8601/,
  )
  await assert.rejects(
    scanLiveOrdersForRecovery(env, {
      staleBefore: '2026-09-29T07:45:00.000Z',
      limit: 501,
    }),
    /limit must be an integer between 1 and 500/,
  )
})

test('recovery scan can be restricted to one authorized exchange account', async () => {
  const { env, capture } = fakeEnv([])
  await scanLiveOrdersForRecovery(env, {
    staleBefore: '2026-09-29T07:45:00.000Z',
    exchangeAccountId: 'acct-1',
    limit: 10,
  })

  assert.match(capture.sql, /exchange_account_id = \?/)
  assert.deepEqual(capture.bindings.slice(-3), [
    '2026-09-29T07:45:00.000Z',
    'acct-1',
    10,
  ])
})
