import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBtccRecoverySnapshotEvidence,
  requiredBtccRecoveryCapabilities,
  validateBtccRecoveryManifest,
} from '../src/live/adapters/btcc/recovery.ts'
import {
  BtccApiManifestUnavailable,
  type BtccReadOnlyApiManifest,
} from '../src/live/adapters/btcc/contract.ts'

function manifest(
  overrides: Partial<BtccReadOnlyApiManifest> = {},
): BtccReadOnlyApiManifest {
  return {
    officialGuideRevision: '2026-07-17',
    restOrigin: 'https://official-api.example.invalid',
    manifestSha256: 'a'.repeat(64),
    endpoints: [
      { name: 'active_orders_snapshot', method: 'GET', path: '/official/read/active-orders' },
      { name: 'order_history_snapshot', method: 'GET', path: '/official/read/order-history' },
      { name: 'fill_history_snapshot', method: 'GET', path: '/official/read/fill-history' },
    ],
    ...overrides,
  }
}

test('BTCC recovery remains unavailable without an official reviewed manifest', () => {
  assert.throws(
    () => validateBtccRecoveryManifest(null),
    BtccApiManifestUnavailable,
  )
})

test('BTCC recovery requires every semantic snapshot capability', () => {
  const incomplete = manifest({
    endpoints: manifest().endpoints.slice(0, 2),
  })
  assert.throws(
    () => validateBtccRecoveryManifest(incomplete),
    /fill_history_snapshot/,
  )
})

test('base manifest validation rejects mutating endpoint definitions', () => {
  const mutating = manifest({
    endpoints: [
      ...manifest().endpoints,
      { name: 'cancel_order', method: 'GET', path: '/official/read/cancel-order' },
    ],
  })
  assert.throws(
    () => validateBtccRecoveryManifest(mutating),
    /not read-only|appears mutating/,
  )
})

test('complete reviewed manifest resolves semantic GET bindings only', () => {
  const contract = validateBtccRecoveryManifest(manifest())

  assert.deepEqual(requiredBtccRecoveryCapabilities(), [
    'active_orders_snapshot',
    'order_history_snapshot',
    'fill_history_snapshot',
  ])
  assert.equal(contract.exchange, 'BTCC')
  assert.equal(contract.endpointSchemaImported, true)
  assert.equal(contract.endpoints.active_orders_snapshot.method, 'GET')
  assert.equal(contract.endpoints.order_history_snapshot.endpointName, 'order_history_snapshot')
  assert.equal(contract.endpoints.fill_history_snapshot.path, '/official/read/fill-history')
  assert.equal(contract.readOnly, true)
  assert.equal(contract.providerMutationAllowed, false)
  assert.equal(contract.executionAllowed, false)
})

test('snapshot evidence is bounded, complete, manifest-bound, and deterministic', async () => {
  const contract = validateBtccRecoveryManifest(manifest())
  const input = {
    capability: 'fill_history_snapshot' as const,
    snapshotId: 'btcc-recovery-fill-1',
    observedAt: '2026-07-17T22:10:01.000Z',
    windowStartAt: '2026-07-17T22:00:00.000Z',
    windowEndAt: '2026-07-17T22:10:00.000Z',
    itemCount: 2,
    maximumItems: 100,
    complete: true,
    bounded: true,
    payload: [{ fillId: 'fill-1' }, { fillId: 'fill-2' }],
  }
  const first = await buildBtccRecoverySnapshotEvidence(contract, input)
  const second = await buildBtccRecoverySnapshotEvidence(contract, input)

  assert.equal(first.snapshotHash, second.snapshotHash)
  assert.match(first.snapshotHash, /^[a-f0-9]{64}$/)
  assert.equal(first.manifestSha256, 'a'.repeat(64))
  assert.equal(first.complete, true)
  assert.equal(first.bounded, true)
  assert.equal(first.providerMutationAllowed, false)
  assert.equal(first.executionAllowed, false)
})

test('incomplete, unbounded, oversized, or invalid-window snapshots fail closed', async () => {
  const contract = validateBtccRecoveryManifest(manifest())
  const base = {
    capability: 'active_orders_snapshot' as const,
    snapshotId: 'btcc-recovery-orders-1',
    observedAt: '2026-07-17T22:10:01.000Z',
    windowStartAt: '2026-07-17T22:00:00.000Z',
    windowEndAt: '2026-07-17T22:10:00.000Z',
    itemCount: 1,
    maximumItems: 100,
    complete: true,
    bounded: true,
    payload: [],
  }

  await assert.rejects(
    buildBtccRecoverySnapshotEvidence(contract, { ...base, complete: false }),
    /must be complete/,
  )
  await assert.rejects(
    buildBtccRecoverySnapshotEvidence(contract, { ...base, bounded: false }),
    /must be bounded/,
  )
  await assert.rejects(
    buildBtccRecoverySnapshotEvidence(contract, { ...base, itemCount: 101 }),
    /exceeds the reviewed bound/,
  )
  await assert.rejects(
    buildBtccRecoverySnapshotEvidence(contract, {
      ...base,
      windowStartAt: base.windowEndAt,
    }),
    /window must be increasing/,
  )
})
