import { canonicalHash, canonicalJson } from './canonical-json.ts'
import { asDecimalString, isPositiveDecimal } from './decimal.ts'
import { planRecoveryLookup } from './recovery-reconciliation-plan.ts'
import type { LiveRecoveryCandidate } from './recovery-scan.ts'
import { claimQueueDelivery, completeQueueDelivery, failQueueDelivery, registerQueueDelivery } from './queue-contracts.ts'
import { assertExternalRecoveryAttestation } from './bitget-attested-recovery-ingestion.ts'
import { runAttestedBitgetRecoveryCycle } from './bitget-recovery-cycle.ts'
import { BitgetReadOnlyClient } from './adapters/bitget/read-only-client.ts'
import { BitgetCertificationSecretsStoreProvider, type BitgetCertificationSecretsStoreEnv } from './adapters/bitget/certification-secret-provider.ts'
import { BitgetReadOnlyRecoveryClient } from './adapters/bitget/recovery.ts'
import { initialBitgetUserStreamCursor } from './adapters/bitget/user-stream.ts'

export interface ScheduledRecoveryReadEnv extends Partial<BitgetCertificationSecretsStoreEnv> {
  DB: D1Database
  LIVE_RECOVERY_READ_ENABLED?: string
  LIVE_RECOVERY_READ_ACCOUNT_ID?: string
  LIVE_RECOVERY_READ_ATTESTATIONS?: string
}

type Work = { event_id: string; exchange_account_id: string; correlation_id: string; payload_json: string }
type PersistedOrder = {
  internal_order_id: string; exchange_account_id: string; product_id: string
  exchange_order_id: string | null; client_order_id: string | null
  state: LiveRecoveryCandidate['state']; updated_at: string; created_at: string
  requested_base_quantity: string | null; side: string; order_type: string
}

function config(env: ScheduledRecoveryReadEnv): { accountId: string; attestations: Record<string, string> } {
  const accountId = env.LIVE_RECOVERY_READ_ACCOUNT_ID ?? ''
  if (!/^[A-Za-z0-9:_-]{1,128}$/.test(accountId)) throw new TypeError('recovery read account scope is required')
  const parsed: unknown = JSON.parse(env.LIVE_RECOVERY_READ_ATTESTATIONS ?? '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('recovery attestations are required')
  const entries = Object.entries(parsed)
  if (entries.length < 1 || entries.length > 20 || entries.some(([product, id]) =>
    !/^[A-Z0-9]{2,20}-[A-Z0-9]{2,20}$/.test(product)
    || typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(id))) {
    throw new TypeError('recovery attestations must map 1–20 products to explicit attestation IDs')
  }
  return { accountId, attestations: Object.fromEntries(entries) }
}

/**
 * Consume bounded GET-only discovery work using existing certification secrets,
 * recovery client and attested ingestion. This stage persists observations and
 * accounting intents; the existing explicit approval/DO accounting stage remains
 * authoritative. It cannot submit/cancel orders or apply financial projections.
 */
export async function consumeScheduledRecoveryReads(
  env: ScheduledRecoveryReadEnv,
  nowMs: number,
  options: { fetcher?: typeof fetch } = {},
): Promise<{ status: 'DISABLED' | 'CONSUMED'; completed: number; failed: number }> {
  if (env.LIVE_RECOVERY_READ_ENABLED !== 'true') return { status: 'DISABLED', completed: 0, failed: 0 }
  if (!Number.isSafeInteger(nowMs) || nowMs < 300_000) throw new TypeError('recovery read timestamp is invalid')
  const { accountId, attestations } = config(env)
  const account = await env.DB.prepare(`SELECT exchange_name, status, external_account_ref_hash
    FROM live_exchange_accounts WHERE exchange_account_id = ?`).bind(accountId)
    .first<{ exchange_name: string; status: string; external_account_ref_hash: string }>()
  if (!account || account.exchange_name !== 'BITGET'
    || !['READ_ONLY', 'READY', 'HALTED', 'RESTRICTED'].includes(account.status)
    || !/^[a-f0-9]{64}$/.test(account.external_account_ref_hash)) {
    throw new TypeError('recovery read account/provider identity is unavailable')
  }
  const now = new Date(nowMs).toISOString()
  // Only GET observation work is reclaimable. Never reclaim a financial command.
  // The timestamp fence prevents an expired worker completing a successor lease.
  await env.DB.prepare(`UPDATE live_queue_messages SET status = 'FAILED',
      available_at = ?, last_error_code = 'RECOVERY_READ_LEASE_EXPIRED'
    WHERE exchange_account_id = ? AND message_type = 'RECONCILE_ACCOUNT'
      AND json_extract(payload_json, '$.kind') = 'RECOVERY_DISCOVERY'
      AND status = 'PROCESSING' AND processing_started_at < ?`)
    .bind(now, accountId, new Date(nowMs - 120_000).toISOString()).run()
  const work = await env.DB.prepare(`SELECT event_id, exchange_account_id, correlation_id, payload_json
    FROM live_queue_messages WHERE exchange_account_id = ? AND message_type = 'RECONCILE_ACCOUNT'
      AND json_extract(payload_json, '$.kind') = 'RECOVERY_DISCOVERY'
      AND status IN ('RECEIVED', 'FAILED') AND available_at <= ? AND attempt_count < 3
    ORDER BY received_at, event_id LIMIT 5`).bind(accountId, now).all<Work>()
  const result = { status: 'CONSUMED' as const, completed: 0, failed: 0 }
  for (const row of work.results ?? []) {
    if (!await claimQueueDelivery(env, row.event_id, now, 3)) continue
    try {
      const payload = JSON.parse(row.payload_json)
      if (payload.version !== '1' || payload.kind !== 'RECOVERY_DISCOVERY' || payload.exchangeName !== 'BITGET'
        || row.exchange_account_id !== accountId
        || row.event_id !== `recovery-discovery:${await canonicalHash(payload)}`) {
        throw new TypeError('recovery work identity is invalid')
      }
      const order = await env.DB.prepare(`SELECT internal_order_id, exchange_account_id, exchange_order_id,
        client_order_id, product_id, state, updated_at, created_at, requested_base_quantity, side, order_type
        FROM live_orders WHERE internal_order_id = ? AND exchange_account_id = ?`)
        .bind(row.correlation_id, accountId).first<PersistedOrder>()
      if (!order) throw new TypeError('persisted recovery order is unavailable')
      const candidate: LiveRecoveryCandidate = {
        internalOrderId: order.internal_order_id, exchangeAccountId: order.exchange_account_id,
        exchangeOrderId: order.exchange_order_id, clientOrderId: order.client_order_id,
        productId: order.product_id, state: order.state, updatedAt: order.updated_at,
        recoveryReason: order.state === 'RECOVERY_REQUIRED' ? 'EXPLICIT_RECOVERY_REQUIRED' : 'STALE_EXCHANGE_ACTIVE_ORDER',
      }
      const plan = planRecoveryLookup(candidate)
      if (canonicalJson(plan) !== canonicalJson(payload.plan) || !plan.instruction) {
        throw new TypeError('recovery work changed or requires manual identity review')
      }
      if (order.requested_base_quantity === null) throw new TypeError('quote-sized or unknown-sized recovery requires review')
      const quantity = asDecimalString(order.requested_base_quantity)
      if (!isPositiveDecimal(quantity)) throw new TypeError('persisted order quantity is invalid')
      const startTimeMs = Date.parse(order.created_at) - 60_000
      if (!Number.isSafeInteger(startTimeMs) || startTimeMs < 0 || nowMs <= startTimeMs
        || nowMs - startTimeMs > 90 * 86_400_000) throw new TypeError('complete recovery history window is unavailable')
      const attestationId = attestations[order.product_id]
      if (!attestationId) throw new TypeError('scoped recovery attestation is unavailable')
      await assertExternalRecoveryAttestation(env, { attestationId, exchangeAccountId: accountId, productId: order.product_id, now })
      // Resolve once: a key rotation cannot mix accounts across parallel reads.
      const secrets = await new BitgetCertificationSecretsStoreProvider(env as BitgetCertificationSecretsStoreEnv).read()
      const client = new BitgetReadOnlyClient({ secretProvider: { read: async () => secrets }, fetcher: options.fetcher, timeoutMs: 5_000 })
      const permissions = await client.verifyReadOnlyPermissions()
      if (await canonicalHash(permissions.userId) !== account.external_account_ref_hash) throw new TypeError('provider account identity mismatch')
      const recovery = await new BitgetReadOnlyRecoveryClient(client).recover(initialBitgetUserStreamCursor(), {
        symbol: order.product_id, startTimeMs, endTimeMs: nowMs, limit: 100,
      }, now)
      const matched = recovery.snapshot.orders.filter((item) => plan.instruction!.lookupBy === 'EXCHANGE_ORDER_ID'
        ? item.exchangeOrderId === plan.instruction!.lookupValue : item.clientOrderId === plan.instruction!.lookupValue)
      if (matched.length !== 1 || matched[0]!.side !== order.side || matched[0]!.orderType !== order.order_type) {
        throw new TypeError('provider order scope mismatch')
      }
      // Same account/snapshot has stable ingestion identity and timestamps even
      // after a crash between attested persistence and queue acknowledgement.
      const evidenceKey = await canonicalHash({ accountId, snapshotHash: recovery.snapshotHash, attestationId })
      const observedAt = new Date(recovery.snapshot.serverTimestampMs).toISOString()
      const cycle = await runAttestedBitgetRecoveryCycle(env, {
        instruction: plan.instruction, recovery, requestedQuantity: quantity,
        ingestionId: `scheduled-recovery:${evidenceKey}`, bindingId: `scheduled-binding:${evidenceKey}`,
        attestationId, recoveredAt: observedAt, linkedAt: observedAt,
      })
      const notification = await registerQueueDelivery(env, {
        eventId: `recovery-decision:${await canonicalHash({ evidenceKey, internalOrderId: order.internal_order_id })}`,
        messageType: 'NOTIFY_ALERT', exchangeAccountId: accountId, correlationId: order.internal_order_id,
        payload: { kind: 'RECOVERY_RECONCILIATION_DECISION', bindingId: cycle.persistence.bindingId,
          snapshotHash: recovery.snapshotHash, decision: cycle.reconciliation.decision,
          providerMutationAllowed: false, automaticStateProjectionAllowed: false, automaticAccountingDispatchAllowed: false },
        receivedAt: observedAt, availableAt: observedAt,
      })
      if (notification.state === 'CONFLICT') throw new TypeError('recovery decision evidence conflict')
      if (await completeQueueDelivery(env, row.event_id, new Date().toISOString(), now)) result.completed += 1
    } catch {
      // Provider text/credentials never enter queue error detail or logs.
      if (await failQueueDelivery(env, { eventId: row.event_id, errorCode: 'RECOVERY_READ_REVIEW_REQUIRED',
        retryAt: new Date(nowMs + 60_000).toISOString(), expectedStartedAt: now })) result.failed += 1
    }
  }
  return result
}
