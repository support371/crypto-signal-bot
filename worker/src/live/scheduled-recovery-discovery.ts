import { canonicalHash } from './canonical-json.ts'
import { registerQueueDelivery } from './queue-contracts.ts'
import { planRecoveryLookup } from './recovery-reconciliation-plan.ts'
import { scanLiveOrdersForRecovery } from './recovery-scan.ts'

export interface ScheduledRecoveryDiscoveryEnv {
  DB: D1Database
  LIVE_RECOVERY_DISCOVERY_ENABLED?: string
  LIVE_RECOVERY_ACCOUNT_IDS?: string
}

/**
 * Bounded restart discovery, using the existing D1 queue contract. This queues
 * GET-only lookup plans, never financial commands. An unchanged persisted
 * candidate has the same event/hash across cron redelivery and Worker restarts.
 * Provider reads, attestation and accounting remain separate verified stages.
 */
export async function discoverScheduledRecovery(
  env: ScheduledRecoveryDiscoveryEnv,
  scheduledAtMs: number,
): Promise<{ status: 'DISABLED' | 'DISCOVERED'; registered: number; duplicates: number; manualReview: number }> {
  if (env.LIVE_RECOVERY_DISCOVERY_ENABLED !== 'true') {
    return { status: 'DISABLED', registered: 0, duplicates: 0, manualReview: 0 }
  }
  if (!Number.isSafeInteger(scheduledAtMs) || scheduledAtMs < 300_000) {
    throw new TypeError('recovery schedule timestamp is invalid')
  }
  let parsed: unknown
  try { parsed = JSON.parse(env.LIVE_RECOVERY_ACCOUNT_IDS ?? '') } catch {
    throw new TypeError('recovery account allowlist is required')
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 25
    || parsed.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(id))
    || new Set(parsed).size !== parsed.length) {
    throw new TypeError('recovery account allowlist must contain 1–25 unique account IDs')
  }
  const accountIds = parsed as string[]
  // Validate every scope before creating any work. BTCC is never silently
  // routed to Bitget; disconnected/closed accounts require operator review.
  for (const accountId of accountIds) {
    const account = await env.DB.prepare(`
      SELECT exchange_name, status FROM live_exchange_accounts WHERE exchange_account_id = ?
    `).bind(accountId).first<{ exchange_name: string; status: string }>()
    if (!account || account.exchange_name !== 'BITGET'
      || !['READ_ONLY', 'READY', 'HALTED', 'RESTRICTED'].includes(account.status)) {
      throw new TypeError('recovery account is unavailable or its provider is unsupported')
    }
  }
  const result = { status: 'DISCOVERED' as const, registered: 0, duplicates: 0, manualReview: 0 }
  // A global per-invocation cap keeps cron work bounded across all accounts.
  let remaining = 100
  for (const accountId of accountIds) {
    if (remaining === 0) break
    const candidates = await scanLiveOrdersForRecovery(env, {
      exchangeAccountId: accountId,
      staleBefore: new Date(scheduledAtMs - 300_000).toISOString(),
      limit: remaining,
      excludeDiscovered: true,
    })
    for (const candidate of candidates) {
      if (candidate.exchangeAccountId !== accountId) throw new TypeError('recovery candidate account mismatch')
      const plan = planRecoveryLookup(candidate)
      const payload = { version: '1', kind: 'RECOVERY_DISCOVERY', exchangeName: 'BITGET', plan }
      const eventId = `recovery-discovery:${await canonicalHash(payload)}`
      const delivery = await registerQueueDelivery(env, {
        eventId,
        messageType: 'RECONCILE_ACCOUNT',
        exchangeAccountId: accountId,
        correlationId: candidate.internalOrderId,
        payload,
        // Use persisted observation time so cron replay retains the exact hash.
        receivedAt: candidate.updatedAt,
        availableAt: candidate.updatedAt,
      })
      if (delivery.state === 'CONFLICT') throw new Error('RECOVERY_DISCOVERY_EVIDENCE_CONFLICT')
      if (delivery.state === 'REGISTERED') result.registered += 1
      else result.duplicates += 1
      if (plan.status === 'MANUAL_REVIEW_REQUIRED') result.manualReview += 1
      remaining -= 1
    }
  }
  return result
}
