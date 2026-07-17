import assert from 'node:assert/strict'
import test from 'node:test'

import {
  executeFreshApprovedRecoveryAccountingPackage,
  loadFreshApprovedRecoveryAccountingPackage,
  RecoveryAccountingApprovalExpiredError,
  type FreshApprovedRecoveryAccountingPackage,
} from '../src/live/recovery-accounting-dispatch-freshness.ts'
import {
  RecoveryAccountingDispatchNotApprovedError,
} from '../src/live/recovery-accounting-dispatch.ts'
import { FillAccountingSerialQueue } from '../src/live/fill-accounting-serialization.ts'
import type { VerifiedFillAccountingResult } from '../src/live/fill-accounting-service.ts'
import { calculateBitgetRecoveryAccountingPlanHash } from '../src/live/recovery-accounting-plan-integrity.ts'
import { canonicalHash } from '../src/live/canonical-json.ts'
import { asDecimalString, asSignedDecimalString } from '../src/live/decimal.ts'

interface FakeStatement {
  sql: string
  params: unknown[]
  bind(...params: unknown[]): FakeStatement
  first<T>(): Promise<T | null>
}

class FakeD1 {
  plan: Record<string, unknown> | null = null
  approval: Record<string, unknown> | null = null
  validity: Record<string, unknown> | null = null

  prepare(sql: string): D1PreparedStatement {
    const database = this
    const base: FakeStatement = {
      sql,
      params: [],
      bind(...params: unknown[]) {
        return {
          sql,
          params,
          bind: base.bind,
          first: async <T>() => database.first<T>(sql),
        }
      },
      first: async <T>() => database.first<T>(sql),
    }
    return base as unknown as D1PreparedStatement
  }

  async first<T>(sql: string): Promise<T | null> {
    if (sql.includes('FROM live_recovery_accounting_plans')) return this.plan as T | null
    if (sql.includes('FROM live_recovery_accounting_approval_events')) {
      return this.approval as T | null
    }
    if (sql.includes('FROM live_recovery_accounting_approval_validity')) {
      return this.validity as T | null
    }
    return null
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

async function configuredDatabase(): Promise<FakeD1> {
  const database = new FakeD1()
  const commands = [{
    exchangeName: 'BITGET' as const,
    exchangeAccountId: 'bitget-account-ref',
    internalOrderId: 'internal-order-1',
    correlationId: 'correlation-1',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    fill: {
      fillId: 'fill-1',
      tradeId: 'trade-1',
      exchangeOrderId: 'exchange-order-1',
      productId: 'BTC-USDT',
      side: 'BUY' as const,
      price: asDecimalString('50000'),
      baseSize: asDecimalString('0.01'),
      commission: asDecimalString('0'),
      commissionAsset: null,
      tradeTime: '2026-07-17T22:00:00.000Z',
      sequenceTimestamp: '2026-07-17T22:00:01.000Z',
    },
    feeQuoteValue: null,
    accounts: {
      baseInventoryAccountId: 'ledger:BTC:inventory',
      baseReservedAccountId: 'ledger:BTC:reserved',
      baseClearingAccountId: 'ledger:BTC:clearing',
      quoteAvailableAccountId: 'ledger:USDT:available',
      quoteReservedAccountId: 'ledger:USDT:reserved',
      quoteClearingAccountId: 'ledger:USDT:clearing',
      feeExpenseAccountId: null,
      feeSourceAccountId: null,
    },
    rawResponseHash: 'b'.repeat(64),
  }]
  const hashable = {
    exchangeName: 'BITGET' as const,
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    recoverySnapshotHash: 'a'.repeat(64),
    commandCount: 1,
    commands,
    accountingEvidenceReady: true as const,
    automaticallyDispatched: false as const,
    providerMutationAllowed: false as const,
    reservationApplied: false as const,
    executionAllowed: false as const,
  }
  const planHash = await calculateBitgetRecoveryAccountingPlanHash(hashable)
  database.plan = {
    plan_id: 'recovery-plan-1',
    plan_hash: planHash,
    recovery_snapshot_hash: hashable.recoverySnapshotHash,
    exchange_account_id: hashable.exchangeAccountId,
    product_id: hashable.productId,
    command_count: 1,
    commands_json: JSON.stringify(commands),
    accounting_evidence_ready: 1,
    automatically_dispatched: 0,
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
  }
  database.approval = {
    approval_event_id: 'approval-event-1',
    authorization_event_id: 'authorization-event-1',
    plan_id: 'recovery-plan-1',
    plan_hash: planHash,
    actor_id: 'risk-operator-1',
    decision: 'APPROVED',
    authorization_allowed: 1,
    approval_hash: 'c'.repeat(64),
    automatically_dispatched: 0,
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
    occurred_at: '2026-07-17T22:00:00.000Z',
  }
  const validFrom = '2026-07-17T22:00:00.000Z'
  const expiresAt = '2026-07-17T22:05:00.000Z'
  const validitySeconds = 300
  database.validity = {
    approval_event_id: 'approval-event-1',
    plan_id: 'recovery-plan-1',
    plan_hash: planHash,
    valid_from: validFrom,
    expires_at: expiresAt,
    validity_seconds: validitySeconds,
    validity_hash: await canonicalHash({
      approvalEventId: 'approval-event-1',
      planId: 'recovery-plan-1',
      planHash,
      validFrom,
      expiresAt,
      validitySeconds,
      operatorApproved: true,
      automaticallyDispatched: false,
      automaticallyRetried: false,
      providerMutationAllowed: false,
      reservationApplied: false,
      executionAllowed: false,
    }),
    operator_approved: 1,
    automatically_dispatched: 0,
    automatically_retried: 0,
    provider_mutation_allowed: 0,
    reservation_applied: 0,
    execution_allowed: 0,
  }
  return database
}

function accountingResult(): VerifiedFillAccountingResult {
  return {
    status: 'PROJECTED',
    accountingReceiptId: 'receipt:fill-1',
    fillId: 'fill-1',
    journalId: 'journal:fill-1',
    accountingHash: 'd'.repeat(64),
    positionQuantity: asDecimalString('0.01'),
    cumulativeRealizedPnlQuote: asSignedDecimalString('0'),
    providerMutationAllowed: false,
    reservationApplied: false,
    executionAllowed: false,
    exchangeName: 'BITGET',
    replayStateVerified: false,
  }
}

test('approval is fresh strictly inside the validity window', async () => {
  const database = await configuredDatabase()
  const loaded = await loadFreshApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    '2026-07-17T22:04:59.999Z',
  )

  assert.equal(loaded.approvalValidFrom, '2026-07-17T22:00:00.000Z')
  assert.equal(loaded.approvalExpiresAt, '2026-07-17T22:05:00.000Z')
  assert.match(loaded.approvalValidityHash, /^[a-f0-9]{64}$/)
})

test('future and expired approval windows are rejected', async () => {
  const database = await configuredDatabase()
  await assert.rejects(
    loadFreshApprovedRecoveryAccountingPackage(
      database.env(),
      'recovery-plan-1',
      'approval-event-1',
      '2026-07-17T21:59:59.999Z',
    ),
    /not valid yet/,
  )
  await assert.rejects(
    loadFreshApprovedRecoveryAccountingPackage(
      database.env(),
      'recovery-plan-1',
      'approval-event-1',
      '2026-07-17T22:05:00.000Z',
    ),
    RecoveryAccountingApprovalExpiredError,
  )
})

test('missing validity evidence blocks dispatch', async () => {
  const database = await configuredDatabase()
  database.validity = null
  await assert.rejects(
    loadFreshApprovedRecoveryAccountingPackage(
      database.env(),
      'recovery-plan-1',
      'approval-event-1',
      '2026-07-17T22:01:00.000Z',
    ),
    RecoveryAccountingDispatchNotApprovedError,
  )
})

test('validity hash and capability corruption are rejected', async () => {
  const hashCorrupt = await configuredDatabase()
  assert.ok(hashCorrupt.validity)
  hashCorrupt.validity.validity_hash = '0'.repeat(64)
  await assert.rejects(
    loadFreshApprovedRecoveryAccountingPackage(
      hashCorrupt.env(),
      'recovery-plan-1',
      'approval-event-1',
      '2026-07-17T22:01:00.000Z',
    ),
    /validity hash is invalid/,
  )

  const capabilityCorrupt = await configuredDatabase()
  assert.ok(capabilityCorrupt.validity)
  capabilityCorrupt.validity.execution_allowed = 1
  await assert.rejects(
    loadFreshApprovedRecoveryAccountingPackage(
      capabilityCorrupt.env(),
      'recovery-plan-1',
      'approval-event-1',
      '2026-07-17T22:01:00.000Z',
    ),
    /capability locks/,
  )
})

test('fresh approved package can execute serialized accounting only', async () => {
  const database = await configuredDatabase()
  const loaded = await loadFreshApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    '2026-07-17T22:01:00.000Z',
  )
  const result = await executeFreshApprovedRecoveryAccountingPackage(
    'dispatch-fresh-1',
    loaded,
    {
      serializer: new FillAccountingSerialQueue(),
      async executeAccountingCommand() {
        return accountingResult()
      },
    },
  )

  assert.equal(result.status, 'COMPLETED')
  assert.equal(result.automaticallyDispatched, false)
  assert.equal(result.automaticallyRetried, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.reservationApplied, false)
  assert.equal(result.executionAllowed, false)
})

test('forged fresh package cannot execute', async () => {
  const database = await configuredDatabase()
  const verified = await loadFreshApprovedRecoveryAccountingPackage(
    database.env(),
    'recovery-plan-1',
    'approval-event-1',
    '2026-07-17T22:01:00.000Z',
  )
  const forged = {
    ...verified,
  } as FreshApprovedRecoveryAccountingPackage

  await assert.rejects(
    executeFreshApprovedRecoveryAccountingPackage(
      'dispatch-forged',
      forged,
      {
        serializer: new FillAccountingSerialQueue(),
        async executeAccountingCommand() {
          return accountingResult()
        },
      },
    ),
    /lacks fresh approval evidence/,
  )
})
