import { settleReviewedFill } from './reviewed-fill-settlement.ts'
import { ReservationSettlementConflictError } from './reservation-settlement-store.ts'
import {
  ExchangeAccountCoordinator as BaseExchangeAccountCoordinator,
  type AccountCoordinatorEnv,
} from './account-coordinator.ts'
import {
  persistCandidateProjectionObservability,
  type CandidateProjectionObservation,
} from './candidate-projection-observability.ts'
import type { CandidateEvidenceEnvelope } from './candidate-evidence.ts'
import type { CandidateProjectionStatus } from './candidate-projection-retry.ts'
import {
  FillAccountingConflictError,
} from './fill-accounting-store.ts'
import {
  persistSpotFillAccountingVerified,
  type VerifiedSpotFillAccountingInput,
} from './fill-accounting-service.ts'
import {
  FillAccountingReconciliationConflictError,
  FillAccountingReconciliationUnavailableError,
  persistFillAccountingReconciliation,
  type PersistFillAccountingReconciliationInput,
} from './fill-accounting-reconciliation-store.ts'
import { assertCurrentOrderCompletionAuthorization, OrderCompletionAuthorizationError } from './order-completion-authorization.ts'
import { persistCompletedOrder, OrderCompletionConflictError } from './order-completion-store.ts'
import { releasePartialFillRemainder } from './partial-fill-reservation-release.ts'
import { releaseZeroFillReservations } from './zero-fill-reservation-release.ts'
import { FillAccountingSerialQueue } from './fill-accounting-serialization.ts'
import { assertCurrentRecoveryAccountingAuthorization } from './recovery-accounting-current-authorization.ts'
import {
  orchestrateFreshRecoveryAccountingDispatch,
  RecoveryAccountingDispatchAttemptConflictError,
  type FreshRecoveryAccountingDispatchInput,
} from './recovery-accounting-fresh-dispatch-orchestrator.ts'
import {
  RecoveryAccountingApprovalExpiredError,
} from './recovery-accounting-dispatch-freshness.ts'
import {
  RecoveryAccountingDispatchNotApprovedError,
  RecoveryAccountingDispatchConflictError,
} from './recovery-accounting-dispatch.ts'

interface ObservedAccountCoordinatorEnv extends AccountCoordinatorEnv {
  CANDIDATE_ACCOUNTING_TOKEN?: string
}

type ProjectionEventRow = {
  sequence_id: number
  projection_event_id: string
  next_status: CandidateProjectionStatus
  attempt_count: number
  error_code: string | null
  occurred_at: string
  next_attempt_at: string | null
  first_failed_at: string | null
  last_error_code: string | null
  envelope_json: string
}

type CursorRow = {
  last_sequence_id: number
}

const OBSERVABILITY_CURSOR_ID = 1
const MAX_OBSERVABILITY_EVENTS_PER_PASS = 50
const OBSERVABILITY_RETRY_DELAY_MS = 60_000
const ACCOUNTING_ROUTE = '/candidate/fills/account'
const RECONCILIATION_ROUTE = '/candidate/fills/reconcile'
const REVIEWED_RECOVERY_ROUTE = '/candidate/recovery-accounting/dispatch'
const ACCOUNTING_TOKEN_HEADER = 'X-Candidate-Accounting-Token'
const MAX_ACCOUNTING_REQUEST_BYTES = 512 * 1024

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Live-Candidate': 'read-only',
    },
  })
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left)
  const rightBytes = new TextEncoder().encode(right)
  let difference = leftBytes.length ^ rightBytes.length
  const length = Math.max(leftBytes.length, rightBytes.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

function safeErrorCode(error: unknown): string {
  if (error instanceof FillAccountingConflictError) return error.code
  if (error instanceof Error) return error.name.slice(0, 80)
  return 'UNKNOWN_OBSERVABILITY_ERROR'
}

function parseEnvelope(value: string): CandidateEvidenceEnvelope {
  const parsed = JSON.parse(value) as CandidateEvidenceEnvelope
  if (parsed.executionAllowed !== false) {
    throw new TypeError('candidate observability envelope violates execution lock')
  }
  return parsed
}

/**
 * Decorates the execution-locked coordinator with reporting observability and
 * serialized fill accounting.
 *
 * The base coordinator remains authoritative for candidate assessment evidence.
 * Fill posting and accounting reconciliation are internal-only, independently
 * authenticated, and share one per-account queue so neither can read FIFO,
 * position, P&L, or ledger state while the other is mutating its projection.
 */
export class ExchangeAccountCoordinator {
  private readonly state: DurableObjectState
  private readonly env: ObservedAccountCoordinatorEnv
  private readonly inner: BaseExchangeAccountCoordinator
  private readonly accountingQueue = new FillAccountingSerialQueue()

  constructor(state: DurableObjectState, env: ObservedAccountCoordinatorEnv) {
    this.state = state
    this.env = env
    this.initializeObservabilityCursor()
    this.inner = new BaseExchangeAccountCoordinator(state, env)
  }

  private initializeObservabilityCursor(): void {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS candidate_projection_observability_cursor (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        last_sequence_id INTEGER NOT NULL DEFAULT 0 CHECK (last_sequence_id >= 0),
        failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
        last_error_code TEXT,
        last_attempt_at TEXT,
        updated_at TEXT NOT NULL
      );

      INSERT OR IGNORE INTO candidate_projection_observability_cursor (
        singleton_id, last_sequence_id, failure_count, updated_at
      ) VALUES (1, 0, 0, CURRENT_TIMESTAMP);
    `)
  }

  private cursor(): number {
    return this.state.storage.sql.exec<CursorRow>(`
      SELECT last_sequence_id
        FROM candidate_projection_observability_cursor
       WHERE singleton_id = ?
    `, OBSERVABILITY_CURSOR_ID).one().last_sequence_id
  }

  private readProjectionEvents(afterSequence: number): ProjectionEventRow[] {
    return this.state.storage.sql.exec<ProjectionEventRow>(`
      SELECT e.sequence_id,
             e.projection_event_id,
             e.next_status,
             e.attempt_count,
             e.error_code,
             e.occurred_at,
             o.next_attempt_at,
             o.first_failed_at,
             o.last_error_code,
             a.envelope_json
        FROM candidate_projection_events e
        JOIN candidate_projection_outbox o
          ON o.projection_event_id = e.projection_event_id
        JOIN candidate_assessment_commits a
          ON a.assessment_id = o.assessment_id
       WHERE e.sequence_id > ?
       ORDER BY e.sequence_id ASC
       LIMIT ?
    `, afterSequence, MAX_OBSERVABILITY_EVENTS_PER_PASS).toArray()
  }

  private markDelivered(sequenceId: number, occurredAt: string): void {
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`
        UPDATE candidate_projection_observability_cursor
           SET last_sequence_id = ?,
               failure_count = 0,
               last_error_code = NULL,
               last_attempt_at = ?,
               updated_at = ?
         WHERE singleton_id = ?
           AND last_sequence_id < ?
      `,
      sequenceId,
      occurredAt,
      occurredAt,
      OBSERVABILITY_CURSOR_ID,
      sequenceId)
    })
  }

  private markDeliveryFailure(error: unknown, occurredAt: string): void {
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`
        UPDATE candidate_projection_observability_cursor
           SET failure_count = failure_count + 1,
               last_error_code = ?,
               last_attempt_at = ?,
               updated_at = ?
         WHERE singleton_id = ?
      `,
      safeErrorCode(error),
      occurredAt,
      occurredAt,
      OBSERVABILITY_CURSOR_ID)
    })
  }

  private async scheduleAlarmNoLaterThan(timestampMs: number): Promise<void> {
    const current = await this.state.storage.getAlarm()
    if (current === null || current > timestampMs) {
      await this.state.storage.setAlarm(timestampMs)
    }
  }

  private observation(row: ProjectionEventRow): CandidateProjectionObservation {
    const envelope = parseEnvelope(row.envelope_json)
    if (envelope.projectionEventId !== row.projection_event_id) {
      throw new TypeError('candidate observability projection identifier mismatch')
    }

    return {
      exchangeAccountId: envelope.exchangeAccountId,
      assessmentId: envelope.assessmentId,
      projectionEventId: envelope.projectionEventId,
      status: row.next_status,
      attemptCount: row.attempt_count,
      firstFailedAt: row.first_failed_at,
      nextAttemptAt: row.next_attempt_at,
      lastErrorCode: row.error_code ?? row.last_error_code,
      observedAt: row.occurred_at,
    }
  }

  private async drainProjectionObservability(): Promise<void> {
    let lastSequence = this.cursor()
    const rows = this.readProjectionEvents(lastSequence)
    for (const row of rows) {
      try {
        await persistCandidateProjectionObservability(this.env, this.observation(row))
        this.markDelivered(row.sequence_id, row.occurred_at)
        lastSequence = row.sequence_id
      } catch (error) {
        this.markDeliveryFailure(error, new Date().toISOString())
        await this.scheduleAlarmNoLaterThan(Date.now() + OBSERVABILITY_RETRY_DELAY_MS)
        return
      }
    }

    if (rows.length === MAX_OBSERVABILITY_EVENTS_PER_PASS) {
      await this.scheduleAlarmNoLaterThan(Date.now() + 1_000)
    }
  }

  private authorizeAccounting(request: Request): Response | null {
    const configuredToken = String(this.env.CANDIDATE_ACCOUNTING_TOKEN ?? '').trim()
    if (!configuredToken) {
      return json({
        error: 'Candidate fill accounting is not configured',
        code: 'CANDIDATE_ACCOUNTING_AUTH_NOT_CONFIGURED',
      }, 503)
    }
    const suppliedToken = String(request.headers.get(ACCOUNTING_TOKEN_HEADER) ?? '')
    if (!constantTimeEqual(configuredToken, suppliedToken)) {
      return json({ error: 'Unauthorized', code: 'CANDIDATE_ACCOUNTING_UNAUTHORIZED' }, 401)
    }
    return null
  }

  private async readBoundedJson<T>(request: Request): Promise<T> {
    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ACCOUNTING_REQUEST_BYTES) {
      throw new RangeError('candidate accounting request exceeds size limit')
    }
    const reader = request.body?.getReader()
    if (!reader) throw new SyntaxError('JSON body is required')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > MAX_ACCOUNTING_REQUEST_BYTES) {
          await reader.cancel().catch(() => {})
          throw new RangeError('candidate accounting request exceeds size limit')
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  }

  private async handleAccounting(request: Request): Promise<Response> {
    const unauthorized = this.authorizeAccounting(request)
    if (unauthorized) return unauthorized

    try {
      const input = await this.readBoundedJson<VerifiedSpotFillAccountingInput>(request)
      const result = await this.accountingQueue.run(
        () => persistSpotFillAccountingVerified(this.env, input),
      )
      return json({
        ...result,
        serializedBy: 'EXCHANGE_ACCOUNT_COORDINATOR',
        accountingQueuePending: this.accountingQueue.pendingCount,
        providerMutationAllowed: false,
        reservationApplied: false,
        executionAllowed: false,
      }, result.status === 'REPLAYED' ? 200 : 201)
    } catch (error) {
      const status = error instanceof FillAccountingConflictError
        ? 409
        : error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError
          ? 400
          : 500
      return json({
        error: 'Candidate fill accounting was not persisted',
        code: error instanceof FillAccountingConflictError
          ? error.code
          : error instanceof SyntaxError
            ? 'INVALID_JSON'
            : error instanceof TypeError || error instanceof RangeError
              ? 'INVALID_FILL_ACCOUNTING_INPUT'
              : 'FILL_ACCOUNTING_PERSISTENCE_FAILED',
        providerMutationAllowed: false,
        reservationApplied: false,
        executionAllowed: false,
      }, status)
    }
  }

  private async handleReconciliation(request: Request): Promise<Response> {
    const unauthorized = this.authorizeAccounting(request)
    if (unauthorized) return unauthorized

    try {
      const input = await this.readBoundedJson<PersistFillAccountingReconciliationInput>(request)
      const result = await this.accountingQueue.run(
        () => persistFillAccountingReconciliation(this.env, input),
      )
      return json({
        ...result,
        serializedBy: 'EXCHANGE_ACCOUNT_COORDINATOR',
        accountingQueuePending: this.accountingQueue.pendingCount,
        providerMutationAllowed: false,
        reservationApplied: false,
        executionAllowed: false,
      }, result.projectionStatus === 'REPLAYED' ? 200 : 201)
    } catch (error) {
      const conflict = error instanceof FillAccountingReconciliationConflictError
      const unavailable = error instanceof FillAccountingReconciliationUnavailableError
      const status = conflict
        ? 409
        : unavailable
          ? 422
          : error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError
            ? 400
            : 500
      return json({
        error: 'Candidate fill-accounting reconciliation was not persisted',
        code: conflict || unavailable
          ? error.code
          : error instanceof SyntaxError
            ? 'INVALID_JSON'
            : error instanceof TypeError || error instanceof RangeError
              ? 'INVALID_FILL_ACCOUNTING_RECONCILIATION_INPUT'
              : 'FILL_ACCOUNTING_RECONCILIATION_FAILED',
        providerMutationAllowed: false,
        reservationApplied: false,
        executionAllowed: false,
      }, status)
    }
  }

  private async handleReviewedRecovery(request: Request): Promise<Response> {
    const unauthorized = this.authorizeAccounting(request)
    if (unauthorized) return unauthorized
    // Account identity comes from the namespace routing, never the JSON body.
    // Objects created by idFromString without a name cannot dispatch this stage.
    const accountId = this.state.id.name
    if (!accountId || !/^[A-Za-z0-9:_-]{1,128}$/.test(accountId)) {
      return json({ error: 'Named account coordinator is required',
        code: 'RECOVERY_ACCOUNTING_SCOPE_UNAVAILABLE' }, 503)
    }
    try {
      const input = await this.readBoundedJson<FreshRecoveryAccountingDispatchInput>(request)
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).length !== 3
        || !['dispatchId', 'planId', 'approvalEventId'].every((key) =>
          typeof input[key as keyof FreshRecoveryAccountingDispatchInput] === 'string'
          && /^[A-Za-z0-9:_-]{1,128}$/.test(input[key as keyof FreshRecoveryAccountingDispatchInput]))) {
        throw new TypeError('only immutable dispatch, plan and approval identifiers are accepted')
      }
      const outcome = await orchestrateFreshRecoveryAccountingDispatch(this.env, input, {
        serializer: this.accountingQueue,
        authorizeAccountingPlan: (approved, evaluatedAt) =>
          assertCurrentRecoveryAccountingAuthorization(this.env, approved, evaluatedAt),
        executeAccountingCommand: (command) => persistSpotFillAccountingVerified(this.env, command),
      }, undefined, accountId)
      return json({ ...outcome, serializedBy: 'EXCHANGE_ACCOUNT_COORDINATOR',
        providerMutationAllowed: false, reservationApplied: false, executionAllowed: false,
      }, outcome.dispatch.status === 'COMPLETED' ? 201 : 409)
    } catch (error) {
      const conflict = error instanceof RecoveryAccountingDispatchAttemptConflictError
        || error instanceof RecoveryAccountingDispatchConflictError
      const denied = error instanceof RecoveryAccountingDispatchNotApprovedError
        || error instanceof RecoveryAccountingApprovalExpiredError
      const invalid = error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError
      return json({ error: 'Reviewed recovery accounting was not completed',
        code: conflict || denied ? error.code : invalid ? 'INVALID_RECOVERY_ACCOUNTING_INPUT'
          : 'RECOVERY_ACCOUNTING_PERSISTENCE_FAILED',
        providerMutationAllowed: false, reservationApplied: false, executionAllowed: false,
      }, conflict ? 409 : denied ? 403 : invalid ? 400 : 500)
    }
  }

  private async handleOrderCompletion(request: Request): Promise<Response> {
    const unauthorized = this.authorizeAccounting(request)
    if (unauthorized) return unauthorized
    const accountId = this.state.id.name
    if (!accountId || !/^[A-Za-z0-9:_-]{1,128}$/.test(accountId)) {
      return json({ code: 'ORDER_COMPLETION_SCOPE_UNAVAILABLE' }, 503)
    }
    try {
      const input = await this.readBoundedJson<{ orderId: string; authorizationEventId: string }>(request)
      if (!input || Array.isArray(input) || Object.keys(input).length !== 2
        || !['orderId', 'authorizationEventId'].every((key) =>
          typeof input[key as keyof typeof input] === 'string'
          && /^[A-Za-z0-9:_-]{1,128}$/.test(input[key as keyof typeof input]))) {
        throw new TypeError('only order and completion authorization identifiers are accepted')
      }
      const result = await this.accountingQueue.run(async () => {
        await assertCurrentOrderCompletionAuthorization(this.env, accountId, input.orderId,
          input.authorizationEventId, new Date().toISOString())
        await releaseZeroFillReservations(this.env, accountId, input.orderId, input.authorizationEventId)
        await releasePartialFillRemainder(this.env, accountId, input.orderId, input.authorizationEventId)
        return persistCompletedOrder(this.env, accountId, input.orderId)
      })
      return json({ ...result, serializedBy: 'EXCHANGE_ACCOUNT_COORDINATOR',
        providerMutationAllowed: false, executionAllowed: false }, result.status === 'REPLAYED' ? 200 : 201)
    } catch (error) {
      const denied = error instanceof OrderCompletionAuthorizationError
      const conflict = error instanceof OrderCompletionConflictError
      const invalid = error instanceof TypeError || error instanceof RangeError || error instanceof SyntaxError
      return json({ error: 'Order completion was not persisted',
        code: denied || conflict ? error.code : invalid ? 'INVALID_ORDER_COMPLETION_INPUT' : 'ORDER_COMPLETION_PERSISTENCE_FAILED',
        providerMutationAllowed: false, executionAllowed: false }, denied ? 403 : conflict ? 409 : invalid ? 400 : 500)
    }
  }

  private async handleReviewedSettlement(request: Request): Promise<Response> {
    const unauthorized = this.authorizeAccounting(request)
    if (unauthorized) return unauthorized
    const accountId = this.state.id.name
    if (!accountId || !/^[A-Za-z0-9:_-]{1,128}$/.test(accountId)) return json({ code: 'ORDER_SETTLEMENT_SCOPE_UNAVAILABLE' },503)
    try {
      const input = await this.readBoundedJson<{ fillId: string; authorizationEventId: string }>(request)
      if (!input || Array.isArray(input) || Object.keys(input).length !== 2
        || !['fillId','authorizationEventId'].every((key) => typeof input[key as keyof typeof input] === 'string'
          && /^[A-Za-z0-9:_-]{1,128}$/.test(input[key as keyof typeof input]))) throw new TypeError('immutable IDs required')
      const result = await this.accountingQueue.run(() => settleReviewedFill(this.env,accountId,input.fillId,input.authorizationEventId))
      return json({ ...result,serializedBy:'EXCHANGE_ACCOUNT_COORDINATOR' },result.status==='REPLAYED'?200:201)
    } catch (error) {
      const denied=error instanceof OrderCompletionAuthorizationError
      const conflict=error instanceof ReservationSettlementConflictError
      const invalid=error instanceof TypeError || error instanceof SyntaxError || error instanceof RangeError
      return json({ code:denied||conflict?error.code:invalid?'INVALID_ORDER_SETTLEMENT_INPUT':'ORDER_SETTLEMENT_UNAVAILABLE',
        providerMutationAllowed:false,executionAllowed:false },denied?403:conflict?409:invalid?400:503)
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if (method === 'POST' && url.pathname === '/candidate/reservations/settle') {
      return this.handleReviewedSettlement(request)
    }
    if (method === 'POST' && url.pathname === '/candidate/orders/complete') {
      return this.handleOrderCompletion(request)
    }
    if (method === 'POST' && url.pathname === ACCOUNTING_ROUTE) {
      return this.handleAccounting(request)
    }
    if (method === 'POST' && url.pathname === RECONCILIATION_ROUTE) {
      return this.handleReconciliation(request)
    }
    if (method === 'POST' && url.pathname === REVIEWED_RECOVERY_ROUTE) {
      return this.handleReviewedRecovery(request)
    }

    const response = await this.inner.fetch(request)
    try {
      await this.drainProjectionObservability()
    } catch {
      // Observability cannot alter the authoritative response or execution lock.
    }
    return response
  }

  async alarm(): Promise<void> {
    await this.inner.alarm()
    try {
      await this.drainProjectionObservability()
    } catch {
      // Projection alarms remain bounded and independent from observability.
    }
  }
}
