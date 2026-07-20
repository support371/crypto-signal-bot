import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BitgetDemoDurableRateLimitAuthority,
  type BitgetDemoDurableRateLimitReceipt,
} from '../src/live/adapters/bitget/demo-rate-limit-authority.ts'
import {
  BITGET_DEMO_WRITE_CONTRACT,
  type BitgetDemoRateLimitClaimInput,
} from '../src/live/adapters/bitget/demo-write-transport.ts'
import {
  BITGET_MUTATION_EVIDENCE_ENDPOINTS,
  type BitgetCandidateOperation,
} from '../src/live/adapters/bitget/execution-candidate.ts'

const NOW = Date.parse('2026-07-18T02:00:00.000Z')
const ACCOUNT_ID = 'bitget-demo-account-0001'

class MemoryDurableObjectStorage {
  private values = new Map<string, unknown>()
  private queue: Promise<void> = Promise.resolve()
  transactionCount = 0

  async transaction<T>(closure: (transaction: DurableObjectTransaction) => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    this.transactionCount += 1
    const staged = new Map(this.values)
    const transaction = {
      get: async (key: string | string[]) => {
        if (Array.isArray(key)) {
          return new Map(key.filter((item) => staged.has(item)).map((item) => [item, staged.get(item)]))
        }
        return staged.get(key)
      },
      put: async (key: string | Record<string, unknown>, value?: unknown) => {
        if (typeof key === 'string') staged.set(key, value)
        else for (const [entryKey, entryValue] of Object.entries(key)) staged.set(entryKey, entryValue)
      },
    } as unknown as DurableObjectTransaction

    try {
      const result = await closure(transaction)
      this.values = staged
      return result
    } finally {
      release()
    }
  }

  findKey(prefix: string): string {
    const matches = [...this.values.keys()].filter((key) => key.startsWith(prefix))
    if (matches.length !== 1) throw new Error(`expected one key for ${prefix}, found ${matches.length}`)
    return matches[0]!
  }

  read(key: string): unknown {
    return this.values.get(key)
  }

  corrupt(key: string, value: unknown): void {
    if (!this.values.has(key)) throw new Error(`missing key ${key}`)
    this.values.set(key, value)
  }
}

function endpoint(operation: BitgetCandidateOperation): string {
  if (operation === 'PLACE') return BITGET_MUTATION_EVIDENCE_ENDPOINTS.placeOrder
  if (operation === 'CANCEL') return BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelOrder
  return BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelReplaceOrder
}

function maximum(operation: BitgetCandidateOperation): number {
  return BITGET_DEMO_WRITE_CONTRACT.requestLimitsPerSecond[operation]
}

function claimInput(
  attempt: number | string,
  operation: BitgetCandidateOperation = 'PLACE',
  requestedAtMs = NOW,
  overrides: Partial<BitgetDemoRateLimitClaimInput> = {},
): BitgetDemoRateLimitClaimInput {
  return {
    exchangeAccountId: ACCOUNT_ID,
    dispatchAttemptId: `demo-rate-attempt-${attempt}`,
    candidateHash: String(attempt).padStart(64, 'a').slice(-64).replace(/[^a-f0-9]/g, 'b'),
    operation,
    endpoint: endpoint(operation),
    requestedAtMs,
    windowMs: 1000,
    maximumRequests: maximum(operation),
    ...overrides,
  }
}

function authority(storage: MemoryDurableObjectStorage, now: () => number) {
  return new BitgetDemoDurableRateLimitAuthority({
    storage: storage as unknown as DurableObjectStorage,
    exchangeAccountId: ACCOUNT_ID,
    now,
  })
}

function assertPermanentLocks(receipt: BitgetDemoDurableRateLimitReceipt): void {
  assert.equal(receipt.providerMutationAllowed, false)
  assert.equal(receipt.liveExecutionAllowed, false)
  assert.equal(receipt.realFundsAllowed, false)
  assert.equal(receipt.mainnetAllowed, false)
  assert.equal(receipt.withdrawalsAllowed, false)
  assert.equal(receipt.automaticRetryAllowed, false)
}

test('concurrent place claims are serialized into a strict ten-request sliding window', async () => {
  const storage = new MemoryDurableObjectStorage()
  const limiter = authority(storage, () => NOW)
  const receipts = await Promise.all(
    Array.from({ length: 11 }, (_, index) => limiter.claim(claimInput(index + 1))),
  )

  assert.equal(receipts.filter((receipt) => receipt.allowed).length, 10)
  assert.equal(receipts.filter((receipt) => !receipt.allowed).length, 1)
  assert.deepEqual(receipts.map((receipt) => receipt.observedCountBefore), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.deepEqual(receipts.map((receipt) => receipt.observedCountAfter), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10])
  assert.equal(receipts[10]?.remainingRequests, 0)
  assert.equal(receipts[10]?.replayed, false)
  assert.equal(new Set(receipts.map((receipt) => receipt.receiptHash)).size, 11)
  for (const receipt of receipts) assertPermanentLocks(receipt)
})

test('an identical dispatch attempt replays its immutable receipt without consuming another slot', async () => {
  const storage = new MemoryDurableObjectStorage()
  const limiter = authority(storage, () => NOW)
  const input = claimInput('replay')
  const first = await limiter.claim(input)
  const replay = await limiter.claim(input)

  assert.equal(first.replayed, false)
  assert.equal(replay.replayed, true)
  assert.equal(replay.receiptHash, first.receiptHash)
  assert.equal(replay.observedCountBefore, 0)
  assert.equal(replay.observedCountAfter, 1)

  const additional = await Promise.all(
    Array.from({ length: 10 }, (_, index) => limiter.claim(claimInput(`after-replay-${index}`))),
  )
  assert.equal(additional.filter((receipt) => receipt.allowed).length, 9)
  assert.equal(additional.at(-1)?.allowed, false)
})

test('the same dispatch attempt cannot be rebound to changed candidate evidence', async () => {
  const storage = new MemoryDurableObjectStorage()
  const limiter = authority(storage, () => NOW)
  const input = claimInput('conflict')
  await limiter.claim(input)

  await assert.rejects(
    limiter.claim({ ...input, candidateHash: 'f'.repeat(64) }),
    /receipt conflicts with the requested claim/,
  )
})

test('sliding-window capacity expires exactly after one second', async () => {
  const storage = new MemoryDurableObjectStorage()
  let now = NOW
  const limiter = authority(storage, () => now)
  await Promise.all(Array.from({ length: 10 }, (_, index) => limiter.claim(claimInput(index + 1))))
  const denied = await limiter.claim(claimInput('denied'))
  assert.equal(denied.allowed, false)

  now = NOW + 1_000
  const afterWindow = await limiter.claim(claimInput('after-window', 'PLACE', now))
  assert.equal(afterWindow.allowed, true)
  assert.equal(afterWindow.observedCountBefore, 0)
  assert.equal(afterWindow.observedCountAfter, 1)
  assert.equal(afterWindow.remainingRequests, 9)
})

test('endpoint ceilings are independent and cancel-replace stops at five requests', async () => {
  const storage = new MemoryDurableObjectStorage()
  const limiter = authority(storage, () => NOW)
  const replacementReceipts = await Promise.all(
    Array.from({ length: 6 }, (_, index) => limiter.claim(claimInput(`replace-${index}`, 'CANCEL_REPLACE'))),
  )
  assert.equal(replacementReceipts.filter((receipt) => receipt.allowed).length, 5)
  assert.equal(replacementReceipts[5]?.allowed, false)
  assert.equal(replacementReceipts[5]?.maximumRequests, 5)

  const place = await limiter.claim(claimInput('independent-place'))
  const cancel = await limiter.claim(claimInput('independent-cancel', 'CANCEL'))
  assert.equal(place.allowed, true)
  assert.equal(cancel.allowed, true)
  assert.equal(place.observedCountBefore, 0)
  assert.equal(cancel.observedCountBefore, 0)
})

test('account, endpoint, limit, window, and clock mismatches fail before storage', async () => {
  const invalidCases: Array<Partial<BitgetDemoRateLimitClaimInput>> = [
    { exchangeAccountId: 'another-account' },
    { endpoint: BITGET_MUTATION_EVIDENCE_ENDPOINTS.cancelOrder },
    { maximumRequests: 11 },
    { windowMs: 999 as 1000 },
    { requestedAtMs: NOW - 1_001 },
  ]
  for (const [index, overrides] of invalidCases.entries()) {
    const storage = new MemoryDurableObjectStorage()
    const limiter = authority(storage, () => NOW)
    await assert.rejects(limiter.claim(claimInput(`invalid-${index}`, 'PLACE', NOW, overrides)))
    assert.equal(storage.transactionCount, 0)
  }
})

test('tampered immutable receipts and sliding-window state fail closed', async () => {
  const receiptStorage = new MemoryDurableObjectStorage()
  const receiptLimiter = authority(receiptStorage, () => NOW)
  const receiptInput = claimInput('tampered-receipt')
  await receiptLimiter.claim(receiptInput)
  const receiptKey = receiptStorage.findKey('bitget-demo-rate-receipt:')
  const storedReceipt = receiptStorage.read(receiptKey) as Record<string, unknown>
  receiptStorage.corrupt(receiptKey, { ...storedReceipt, allowed: false })
  await assert.rejects(
    receiptLimiter.claim(receiptInput),
    /receipt conflicts with the requested claim/,
  )

  const stateStorage = new MemoryDurableObjectStorage()
  const stateLimiter = authority(stateStorage, () => NOW)
  await stateLimiter.claim(claimInput('tampered-state'))
  const stateKey = stateStorage.findKey('bitget-demo-rate-window:')
  const storedState = stateStorage.read(stateKey) as Record<string, unknown>
  stateStorage.corrupt(stateKey, { ...storedState, requestTimestampsMs: [NOW - 1, NOW - 2] })
  await assert.rejects(
    stateLimiter.claim(claimInput('after-state-tamper')),
    /failed integrity|invalid or unordered/,
  )
})

test('trusted clock and constructor configuration fail closed', async () => {
  const storage = new MemoryDurableObjectStorage()
  const invalidClock = authority(storage, () => Number.NaN)
  await assert.rejects(invalidClock.claim(claimInput('invalid-clock')), /clock must return Unix milliseconds/)
  assert.throws(
    () => new BitgetDemoDurableRateLimitAuthority({
      storage: storage as unknown as DurableObjectStorage,
      exchangeAccountId: ACCOUNT_ID,
      maxClockSkewMs: 10_001,
    }),
    /maxClockSkewMs/,
  )
  assert.throws(
    () => new BitgetDemoDurableRateLimitAuthority({
      storage: {} as DurableObjectStorage,
      exchangeAccountId: ACCOUNT_ID,
    }),
    /transaction support is required/,
  )
})
