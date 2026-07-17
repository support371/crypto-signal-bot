import assert from 'node:assert/strict'
import test from 'node:test'

import { FillAccountingSerialQueue } from '../src/live/fill-accounting-serialization.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('second fill accounting operation cannot start before first completes', async () => {
  const queue = new FillAccountingSerialQueue()
  const firstGate = deferred<void>()
  const order: string[] = []

  const first = queue.run(async () => {
    order.push('first:start')
    await firstGate.promise
    order.push('first:end')
    return 'first-result'
  })
  const second = queue.run(async () => {
    order.push('second:start')
    order.push('second:end')
    return 'second-result'
  })

  await Promise.resolve()
  assert.deepEqual(order, ['first:start'])
  assert.equal(queue.pendingCount, 2)

  firstGate.resolve()
  assert.equal(await first, 'first-result')
  assert.equal(await second, 'second-result')
  assert.deepEqual(order, [
    'first:start',
    'first:end',
    'second:start',
    'second:end',
  ])
  assert.equal(queue.pendingCount, 0)
})

test('failed accounting operation releases the next queued operation', async () => {
  const queue = new FillAccountingSerialQueue()
  const first = queue.run(async () => {
    throw new Error('expected accounting failure')
  })
  const second = queue.run(async () => 'recovered')

  await assert.rejects(first, /expected accounting failure/)
  assert.equal(await second, 'recovered')
  assert.equal(queue.pendingCount, 0)
})

test('queue validates operation input', async () => {
  const queue = new FillAccountingSerialQueue()
  await assert.rejects(
    queue.run(null as unknown as () => Promise<unknown>),
    /operation is required/,
  )
})
