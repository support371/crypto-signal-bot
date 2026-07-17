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

function safeErrorCode(error: unknown): string {
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
 * Decorates the execution-locked coordinator with reporting observability.
 *
 * The base coordinator remains authoritative. This wrapper reads append-only
 * projection events, writes metrics and alert history to D1, and advances a
 * Durable Object cursor only after successful delivery. It cannot retry an
 * exchange request, apply a reservation, or change execution state.
 */
export class ExchangeAccountCoordinator {
  private readonly state: DurableObjectState
  private readonly env: AccountCoordinatorEnv
  private readonly inner: BaseExchangeAccountCoordinator

  constructor(state: DurableObjectState, env: AccountCoordinatorEnv) {
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

  async fetch(request: Request): Promise<Response> {
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
