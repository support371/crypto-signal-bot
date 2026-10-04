import { evaluateAuthorization, type ScopedRole, type StepUpSession } from './authorization.ts'
import { RecoveryAccountingDispatchNotApprovedError, type ApprovedRecoveryAccountingPackage } from './recovery-accounting-dispatch.ts'

/** Reuse the existing policy with current authority, not historical role JSON. */
export async function assertCurrentRecoveryAccountingAuthorization(
  env: { DB: D1Database }, approved: ApprovedRecoveryAccountingPackage, evaluatedAt: string,
): Promise<void> {
  const evidence = await env.DB.prepare(`SELECT actor_id, step_up_session_id, action, resource_id, decision
    FROM live_authorization_events WHERE authorization_event_id = ?`)
    .bind(approved.authorizationEventId).first<{
      actor_id: string; step_up_session_id: string | null; action: string; resource_id: string; decision: string
    }>()
  if (!evidence || evidence.actor_id !== approved.approvedByActorId
    || evidence.actor_id === approved.planPreparedByActorId || evidence.action !== 'RUN_RECONCILIATION'
    || evidence.resource_id !== approved.planId || evidence.decision !== 'ALLOW' || !evidence.step_up_session_id) {
    throw new RecoveryAccountingDispatchNotApprovedError('current recovery reviewer authority is unavailable')
  }
  const roles = await env.DB.prepare(`SELECT role, scope_type, scope_key, expires_at, revoked_at
    FROM live_actor_roles WHERE actor_id = ?`).bind(evidence.actor_id).all<{
      role: ScopedRole['role']; scope_type: ScopedRole['scopeType']; scope_key: string
      expires_at: string | null; revoked_at: string | null
    }>()
  const row = await env.DB.prepare(`SELECT step_up_session_id, actor_id, assurance_level,
    audience, issued_at, expires_at, revoked_at FROM live_step_up_sessions WHERE step_up_session_id = ?`)
    .bind(evidence.step_up_session_id).first<{
      step_up_session_id: string; actor_id: string; assurance_level: StepUpSession['assuranceLevel']; audience: string
      issued_at: string; expires_at: string; revoked_at: string | null
    }>()
  const decision = evaluateAuthorization({ actorId: evidence.actor_id, action: 'RUN_RECONCILIATION',
    resourceType: 'RECOVERY_ACCOUNTING_PLAN', resourceId: approved.planId,
    exchangeName: 'BITGET', exchangeAccountId: approved.plan.exchangeAccountId,
    resourceOwnerActorId: approved.planPreparedByActorId,
    roles: (roles.results ?? []).map((role) => ({ role: role.role, scopeType: role.scope_type,
      scopeKey: role.scope_key, expiresAt: role.expires_at, revokedAt: role.revoked_at })),
    stepUpSession: row ? { stepUpSessionId: row.step_up_session_id, actorId: row.actor_id,
      assuranceLevel: row.assurance_level, audience: row.audience, issuedAt: row.issued_at,
      expiresAt: row.expires_at, revokedAt: row.revoked_at } : null,
    evaluatedAt,
  })
  if (!decision.allowed || !decision.matchedRoles.some((role) => role === 'RISK_OPERATOR' || role === 'RISK_ADMIN')) {
    throw new RecoveryAccountingDispatchNotApprovedError('current recovery reviewer authority is denied')
  }
  // Approval of a command must not let its ledger or order IDs escape the
  // account scope. Validate the whole plan before claiming/posting its first fill.
  if (approved.plan.commands.length > 100) throw new RangeError('reviewed accounting plan exceeds command limit')
  const ledgerIds = [...new Set(approved.plan.commands.flatMap((command) =>
    Object.values(command.accounts).filter((id): id is string => typeof id === 'string')))]
  const orderIds = [...new Set(approved.plan.commands.map((command) => command.internalOrderId))]
  if (ledgerIds.length > 100 || orderIds.length > 100) throw new RangeError('reviewed accounting scope exceeds lookup limit')
  if (!orderIds.length) return
  const ledgers = await env.DB.prepare(`SELECT ledger_account_id, exchange_account_id, asset, account_type, status
    FROM ledger_accounts WHERE ledger_account_id IN (${ledgerIds.map(() => '?').join(',')})`)
    .bind(...ledgerIds).all<{ ledger_account_id: string; exchange_account_id: string; asset: string; account_type: string; status: string }>()
  const orders = await env.DB.prepare(`SELECT internal_order_id, exchange_account_id, exchange_order_id, product_id, side
    FROM live_orders WHERE internal_order_id IN (${orderIds.map(() => '?').join(',')})`)
    .bind(...orderIds).all<{ internal_order_id: string; exchange_account_id: string; exchange_order_id: string | null; product_id: string; side: string }>()
  const ledgerById = new Map((ledgers.results ?? []).map((row) => [row.ledger_account_id, row]))
  const orderById = new Map((orders.results ?? []).map((row) => [row.internal_order_id, row]))
  for (const command of approved.plan.commands) {
    const order = orderById.get(command.internalOrderId)
    if (command.fill.productId !== `${command.baseAsset}-${command.quoteAsset}`
      || !order || order.exchange_account_id !== approved.plan.exchangeAccountId
      || order.exchange_order_id !== command.fill.exchangeOrderId
      || order.product_id !== command.fill.productId || order.side !== command.fill.side) {
      throw new RecoveryAccountingDispatchNotApprovedError('reviewed fill does not match the persisted account order')
    }
    const expected = {
      baseInventoryAccountId: [command.baseAsset, 'INVENTORY_AVAILABLE'],
      baseReservedAccountId: [command.baseAsset, 'INVENTORY_RESERVED'],
      baseClearingAccountId: [command.baseAsset, 'EXCHANGE_CLEARING'],
      quoteAvailableAccountId: [command.quoteAsset, 'CASH_AVAILABLE'],
      quoteReservedAccountId: [command.quoteAsset, 'CASH_RESERVED'],
      quoteClearingAccountId: [command.quoteAsset, 'EXCHANGE_CLEARING'],
    }
    for (const [key, id] of Object.entries(command.accounts)) {
      if (id === null) continue
      const ledger = ledgerById.get(id)
      const rule = expected[key as keyof typeof expected]
      if (!ledger || ledger.exchange_account_id !== approved.plan.exchangeAccountId || ledger.status !== 'ACTIVE'
        || (rule && (ledger.asset !== rule[0] || ledger.account_type !== rule[1]))
        || (!rule && ledger.asset !== command.fill.commissionAsset)
        || (key === 'feeExpenseAccountId' && ledger.account_type !== 'FEES_EXPENSE')
        || (key === 'feeSourceAccountId' && !['CASH_AVAILABLE', 'CASH_RESERVED', 'INVENTORY_AVAILABLE', 'INVENTORY_RESERVED'].includes(ledger.account_type))) {
        throw new RecoveryAccountingDispatchNotApprovedError('reviewed ledger account scope or asset is invalid')
      }
    }
  }
}
