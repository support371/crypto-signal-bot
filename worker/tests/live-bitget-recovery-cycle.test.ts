import assert from 'node:assert/strict'
import test from 'node:test'

import { asDecimalString } from '../src/live/decimal.ts'
import type { ExchangeOrderSnapshot } from '../src/live/exchange-contracts.ts'
import type { BitgetRestRecoveryResult } from '../src/live/adapters/bitget/recovery.ts'
import {
  runAttestedBitgetRecoveryCycle,
} from '../src/live/bitget-recovery-cycle.ts'
import type { RecoveryLookupInstruction } from '../src/live/recovery-reconciliation-plan.ts'

function recoveredOrder(): ExchangeOrderSnapshot {
  return {
    exchangeOrderId: 'exchange-1',
    clientOrderId: 'client-1',
    productId: 'BTC-USDT',
    side: 'BUY',
    orderType: 'LIMIT',
    rawStatus: 'filled',
    requestedBaseQuantity: asDecimalString('0.01'),
    requestedQuoteNotional: null,
    filledBaseQuantity: asDecimalString('0.01'),
    filledQuoteValue: asDecimalString('800'),
    remainingBaseQuantity: asDecimalString('0'),
    averageFillPrice: asDecimalString('80000'),
    totalFees: asDecimalString('0.8'),
    pendingCancel: false,
    settled: false,
    createdAt: '2026-09-29T08:00:00.000Z',
    updatedAt: '2026-09-29T08:01:00.000Z',
  }
}

function recovery(): BitgetRestRecoveryResult {
  return {
    snapshot: {
      orders: [recoveredOrder()],
      fills: [],
      snapshotAt: '2026-09-29T08:02:00.000Z',
      serverTimestampMs: 1790668920000,
    },
    cursor: {
      connected: false,
      initialized: true,
      ordersSubscribed: false,
      fillsSubscribed: false,
      lastMessageAt: null,
      lastPongAt: null,
      lastServerTimestampMs: 1790668920000,
      lastRestSnapshotAt: '2026-09-29T08:02:00.000Z',
      recentFingerprints: [],
      recoveryRequired: false,
      recoveryReason: null,
    },
    snapshotHash: 'a'.repeat(64),
    windowStartMs: 1790668800000,
    windowEndMs: 1790668920000,
    currentOrderCount: 0,
    historicalOrderCount: 1,
    fillCount: 0,
    readOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
  }
}

const instruction: RecoveryLookupInstruction = {
  internalOrderId: 'internal-1',
  exchangeAccountId: 'account-1',
  productId: 'BTC-USDT',
  lookupBy: 'EXCHANGE_ORDER_ID',
  lookupValue: 'exchange-1',
  method: 'GET',
  mutationAllowed: false,
  automaticRetryAllowed: false,
}

test('attested recovery cycle composes reconciliation, ingestion and persistence', async () => {
  let persisted = false
  const result = await runAttestedBitgetRecoveryCycle(
    { DB: {} as D1Database },
    {
      instruction,
      recovery: recovery(),
      requestedQuantity: asDecimalString('0.01'),
      ingestionId: 'ingestion-1',
      attestationId: 'attestation-1',
      bindingId: 'binding-1',
      recoveredAt: '2026-09-29T08:02:00.000Z',
      linkedAt: '2026-09-29T08:03:00.000Z',
    },
    {
      persistAttested: async (_env, input) => {
        persisted = true
        return {
          persistenceStatus: 'BOUND',
          ingestionPersistenceStatus: 'INGESTED',
          bindingId: input.bindingId,
          bindingHash: 'b'.repeat(64),
          attestationId: input.attestationId,
          certificationRunId: 'run-1',
          runEvidenceHash: 'c'.repeat(64),
          attestationHash: 'd'.repeat(64),
          sourceMode: 'ISOLATED_READ_ONLY_CLIENT',
          certificationEnvironment: 'LIVE_CANDIDATE',
          externalReadOnlyEvidence: true,
          ingestionId: input.plan.ingestionId,
          ingestionHash: input.plan.ingestionHash,
          snapshotId: input.plan.snapshotId,
          snapshotHash: input.plan.snapshotHash,
          exchangeAccountId: input.plan.exchangeAccountId,
          productId: input.plan.productId,
          accountingTaskCount: input.plan.accountingTaskIntents.length,
          automaticAccountingDispatchAllowed: false,
          reservationSettlementAllowed: false,
          certificationCheckProjectionAllowed: false,
          certifiedForLive: false,
          providerMutationAllowed: false,
          automaticRetryAllowed: false,
          transferAllowed: false,
          withdrawalAllowed: false,
          executionAllowed: false,
          credentialsPersisted: false,
          reconciliationRequired: true,
          incidentEvidenceRequired: true,
        }
      },
    },
  )

  assert.equal(persisted, true)
  assert.equal(result.reconciliation.decision.state, 'FILLED')
  assert.equal(result.ingestionPlan.complete, true)
  assert.equal(result.persistence.persistenceStatus, 'BOUND')
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.automaticRetryAllowed, false)
  assert.equal(result.executionAllowed, false)
})
