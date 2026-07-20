import {
  assessBitgetCandidateOrder,
  type CandidateOrderAssessmentInput,
} from './candidate-command-plan.ts'
import {
  attachCoordinatorSequence,
  buildCandidateEvidenceBase,
  CandidateEvidenceConflictError,
  projectCandidateEvidenceToD1,
  type CandidateEvidenceBase,
  type CandidateEvidenceEnvelope,
} from './candidate-evidence.ts'
import {
  decideCandidateProjectionRetry,
  type CandidateProjectionStatus,
} from './candidate-projection-retry.ts'

export interface AccountCoordinatorEnv {
  DB: D1Database
  BUILD_GIT_SHA?: string
  LIVE_EXECUTION_ENABLED?: string
  WITHDRAWALS_ENABLED?: string
  CANDIDATE_EVIDENCE_TOKEN?: string
}

interface CoordinatorMetadata {
  schemaVersion: 3
  createdAt: string
  halted: true
  haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED'
}

type CandidateAssessmentRequest = Omit<CandidateOrderAssessmentInput, 'previewOptions'> & {
  previewOptions: Omit<CandidateOrderAssessmentInput['previewOptions'], 'now'>
}

type LocalAssessmentRow = {
  request_hash: string
  envelope_json: string
}

type OutboxRow = {
  projection_status: CandidateProjectionStatus
  attempt_count: number
  next_attempt_at: string | null
  last_error_code: string | null
}

type PendingProjectionRow = OutboxRow & {
  projection_event_id: string
  assessment_id: string
  payload_hash: string
  envelope_json: string
}

type CountRow = {
  count: number
}

type CounterRow = {
  counter_value: number
}

type EnvelopeRow = {
  envelope_json: string
}

type NextAlarmRow = {
  next_attempt_at: string | null
}

interface CommitResult {
  envelope: CandidateEvidenceEnvelope
  replayed: boolean
  outbox: OutboxRow
}

const METADATA_KEY = 'coordinator:metadata'
const MAX_REQUEST_BYTES = 256 * 1024
const MAX_ALARM_PROJECTIONS = 20
const INTERNAL_TOKEN_HEADER = 'X-Candidate-Evidence-Token'

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
  if (error instanceof CandidateEvidenceConflictError) return error.code
  if (error instanceof SyntaxError) return 'INVALID_JSON'
  if (error instanceof TypeError || error instanceof RangeError) return 'INVALID_CANDIDATE_EVIDENCE'
  return 'CANDIDATE_EVIDENCE_PERSISTENCE_FAILED'
}

function sanitizeProjectionError(error: unknown): string {
  if (error instanceof CandidateEvidenceConflictError) return error.code
  if (error instanceof Error) return error.name.slice(0, 80)
  return 'UNKNOWN_PROJECTION_ERROR'
}

function parseEnvelope(value: string): CandidateEvidenceEnvelope {
  const parsed = JSON.parse(value) as CandidateEvidenceEnvelope
  if (parsed.executionAllowed !== false) {
    throw new CandidateEvidenceConflictError('stored candidate envelope violates execution lock')
  }
  return parsed
}

function projectionEventId(
  projectionId: string,
  attemptCount: number,
  status: CandidateProjectionStatus,
): string {
  return `${projectionId}:${attemptCount}:${status}`
}

/**
 * Serializes candidate evidence for one exchange account.
 *
 * The Durable Object is the authoritative atomic commit boundary. It persists
 * assessment evidence, a reservation draft, and a projection outbox record in
 * one SQLite transaction. D1 is an idempotent reporting projection and never
 * authorizes or applies a reservation.
 */
export class ExchangeAccountCoordinator {
  private readonly state: DurableObjectState
  private readonly env: AccountCoordinatorEnv
  private metadata: CoordinatorMetadata | null = null

  constructor(state: DurableObjectState, env: AccountCoordinatorEnv) {
    this.state = state
    this.env = env
    this.state.blockConcurrencyWhile(async () => {
      this.initializeSqlSchema()
      const existing = await this.state.storage.get<CoordinatorMetadata>(METADATA_KEY)
      if (existing?.schemaVersion === 3) {
        this.metadata = existing
      } else {
        const created: CoordinatorMetadata = {
          schemaVersion: 3,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          halted: true,
          haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
        }
        await this.state.storage.put(METADATA_KEY, created)
        this.metadata = created
      }
      await this.scheduleNextAlarm()
    })
  }

  private initializeSqlSchema(): void {
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS coordinator_counters (
        counter_name TEXT PRIMARY KEY,
        counter_value INTEGER NOT NULL CHECK (counter_value >= 0)
      );

      CREATE TABLE IF NOT EXISTS candidate_assessment_commits (
        assessment_id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
        evidence_hash TEXT NOT NULL UNIQUE CHECK (length(evidence_hash) = 64),
        payload_hash TEXT NOT NULL UNIQUE CHECK (length(payload_hash) = 64),
        coordinator_sequence INTEGER NOT NULL UNIQUE CHECK (coordinator_sequence > 0),
        status TEXT NOT NULL CHECK (status IN ('REJECTED', 'READY_BUT_EXECUTION_LOCKED')),
        execution_allowed INTEGER NOT NULL DEFAULT 0 CHECK (execution_allowed = 0),
        envelope_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS candidate_reservation_drafts (
        reservation_journal_id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL UNIQUE,
        journal_hash TEXT NOT NULL UNIQUE CHECK (length(journal_hash) = 64),
        journal_json TEXT NOT NULL,
        applied INTEGER NOT NULL DEFAULT 0 CHECK (applied = 0),
        committed_at TEXT NOT NULL,
        FOREIGN KEY (assessment_id) REFERENCES candidate_assessment_commits(assessment_id)
      );

      CREATE TABLE IF NOT EXISTS candidate_projection_outbox (
        projection_event_id TEXT PRIMARY KEY,
        assessment_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL UNIQUE CHECK (length(payload_hash) = 64),
        projection_status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (projection_status IN ('PENDING', 'PROJECTED', 'CONFLICT', 'DEAD_LETTER')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error_code TEXT,
        next_attempt_at TEXT,
        first_failed_at TEXT,
        projected_at TEXT,
        dead_lettered_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (assessment_id) REFERENCES candidate_assessment_commits(assessment_id)
      );

      CREATE TABLE IF NOT EXISTS candidate_projection_events (
        sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        projection_event_id TEXT NOT NULL,
        previous_status TEXT,
        next_status TEXT NOT NULL
          CHECK (next_status IN ('PENDING', 'PROJECTED', 'CONFLICT', 'DEAD_LETTER')),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        error_code TEXT,
        occurred_at TEXT NOT NULL,
        FOREIGN KEY (projection_event_id) REFERENCES candidate_projection_outbox(projection_event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_candidate_projection_outbox_due
        ON candidate_projection_outbox(projection_status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_candidate_projection_events_projection
        ON candidate_projection_events(projection_event_id, sequence_id);

      CREATE TRIGGER IF NOT EXISTS candidate_assessment_commits_no_update
      BEFORE UPDATE ON candidate_assessment_commits
      FOR EACH ROW BEGIN
        SELECT RAISE(ABORT, 'candidate_assessment_commits cannot be updated');
      END;

      CREATE TRIGGER IF NOT EXISTS candidate_assessment_commits_no_delete
      BEFORE DELETE ON candidate_assessment_commits
      FOR EACH ROW BEGIN
        SELECT RAISE(ABORT, 'candidate_assessment_commits cannot be deleted');
      END;

      CREATE TRIGGER IF NOT EXISTS candidate_reservation_drafts_no_update
      BEFORE UPDATE ON candidate_reservation_drafts
      FOR EACH ROW BEGIN
        SELECT RAISE(ABORT, 'candidate_reservation_drafts cannot be updated');
      END;

      CREATE TRIGGER IF NOT EXISTS candidate_reservation_drafts_no_delete
      BEFORE DELETE ON candidate_reservation_drafts
      FOR EACH ROW BEGIN
        SELECT RAISE(ABORT, 'candidate_reservation_drafts cannot be deleted');
      END;

      CREATE TRIGGER IF NOT EXISTS candidate_projection_outbox_no_delete
      BEFORE DELETE ON candidate_projection_outbox
      FOR EACH ROW BEGIN
        SELECT RAISE(ABORT, 'candidate_projection_outbox cannot be deleted');
      END;

      CREATE TRIGGER IF NOT EXISTS candidate_projection_events_no_update
      BEFORE UPDATE ON candidate_projection_events
      FOR EACH ROW BEGIN
        SELECT RAISE(ABORT, 'candidate_projection_events cannot be updated');
      END;

      CREATE TRIGGER IF NOT EXISTS candidate_projection_events_no_delete
      BEFORE DELETE ON candidate_projection_events
      FOR EACH ROW BEGIN
        SELECT RAISE(ABORT, 'candidate_projection_events cannot be deleted');
      END;
    `)
  }

  private authorizeInternal(request: Request): Response | null {
    const configuredToken = String(this.env.CANDIDATE_EVIDENCE_TOKEN ?? '').trim()
    if (!configuredToken) {
      return json({
        error: 'Candidate evidence persistence is not configured',
        code: 'CANDIDATE_EVIDENCE_AUTH_NOT_CONFIGURED',
      }, 503)
    }
    const suppliedToken = String(request.headers.get(INTERNAL_TOKEN_HEADER) ?? '')
    if (!constantTimeEqual(configuredToken, suppliedToken)) {
      return json({ error: 'Unauthorized', code: 'CANDIDATE_EVIDENCE_UNAUTHORIZED' }, 401)
    }
    return null
  }

  private countOutbox(status: CandidateProjectionStatus): number {
    return this.state.storage.sql.exec<CountRow>(`
      SELECT COUNT(*) AS count
        FROM candidate_projection_outbox
       WHERE projection_status = ?
    `, status).one().count
  }

  private snapshot(): Record<string, unknown> {
    const assessmentCount = this.state.storage.sql.exec<CountRow>(
      'SELECT COUNT(*) AS count FROM candidate_assessment_commits',
    ).one().count

    return {
      coordinatorId: this.state.id.toString(),
      schemaVersion: this.metadata?.schemaVersion ?? 3,
      createdAt: this.metadata?.createdAt ?? null,
      halted: true,
      haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
      orderSubmissionEnabled: false,
      cancellationEnabled: false,
      withdrawalsEnabled: false,
      candidateEvidencePersistenceEnabled: Boolean(String(this.env.CANDIDATE_EVIDENCE_TOKEN ?? '').trim()),
      assessmentCount,
      pendingProjectionCount: this.countOutbox('PENDING'),
      projectedCount: this.countOutbox('PROJECTED'),
      projectionConflictCount: this.countOutbox('CONFLICT'),
      projectionDeadLetterCount: this.countOutbox('DEAD_LETTER'),
      configuredLiveFlag: String(this.env.LIVE_EXECUTION_ENABLED ?? '').toLowerCase() === 'true',
      configuredWithdrawalsFlag: String(this.env.WITHDRAWALS_ENABLED ?? '').toLowerCase() === 'true',
      buildGitSha: String(this.env.BUILD_GIT_SHA ?? ''),
    }
  }

  private readOutboxByAssessment(assessmentId: string): OutboxRow {
    return this.state.storage.sql.exec<OutboxRow>(`
      SELECT projection_status, attempt_count, next_attempt_at, last_error_code
        FROM candidate_projection_outbox
       WHERE assessment_id = ?
    `, assessmentId).one()
  }

  private readOutboxByProjection(projectionId: string): OutboxRow {
    return this.state.storage.sql.exec<OutboxRow>(`
      SELECT projection_status, attempt_count, next_attempt_at, last_error_code
        FROM candidate_projection_outbox
       WHERE projection_event_id = ?
    `, projectionId).one()
  }

  private commitEvidence(base: CandidateEvidenceBase): CommitResult {
    return this.state.storage.transactionSync(() => {
      const existing = this.state.storage.sql.exec<LocalAssessmentRow>(`
        SELECT request_hash, envelope_json
          FROM candidate_assessment_commits
         WHERE idempotency_key = ?
      `, base.idempotencyKey).toArray()[0]

      if (existing) {
        if (existing.request_hash !== base.requestHash) {
          throw new CandidateEvidenceConflictError('idempotency key was already used with different evidence')
        }
        const envelope = parseEnvelope(existing.envelope_json)
        return {
          envelope,
          replayed: true,
          outbox: this.readOutboxByAssessment(envelope.assessmentId),
        }
      }

      this.state.storage.sql.exec(`
        INSERT OR IGNORE INTO coordinator_counters (counter_name, counter_value)
        VALUES ('candidate_assessment_sequence', 0)
      `)
      this.state.storage.sql.exec(`
        UPDATE coordinator_counters
           SET counter_value = counter_value + 1
         WHERE counter_name = 'candidate_assessment_sequence'
      `)
      const coordinatorSequence = this.state.storage.sql.exec<CounterRow>(`
        SELECT counter_value
          FROM coordinator_counters
         WHERE counter_name = 'candidate_assessment_sequence'
      `).one().counter_value

      const envelope = attachCoordinatorSequence(base, this.state.id.toString(), coordinatorSequence)
      const envelopeJson = JSON.stringify(envelope)

      this.state.storage.sql.exec(`
        INSERT INTO candidate_assessment_commits (
          assessment_id, idempotency_key, request_hash, evidence_hash,
          payload_hash, coordinator_sequence, status, execution_allowed,
          envelope_json, committed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      `,
      envelope.assessmentId,
      envelope.idempotencyKey,
      envelope.requestHash,
      envelope.evidenceHash,
      envelope.payloadHash,
      envelope.coordinatorSequence,
      envelope.status,
      envelopeJson,
      envelope.committedAt)

      if (envelope.reservation) {
        this.state.storage.sql.exec(`
          INSERT INTO candidate_reservation_drafts (
            reservation_journal_id, assessment_id, journal_hash,
            journal_json, applied, committed_at
          ) VALUES (?, ?, ?, ?, 0, ?)
        `,
        envelope.reservation.reservationJournalId,
        envelope.assessmentId,
        envelope.reservation.journalHash,
        envelope.reservation.journalJson,
        envelope.committedAt)
      }

      this.state.storage.sql.exec(`
        INSERT INTO candidate_projection_outbox (
          projection_event_id, assessment_id, payload_hash,
          projection_status, attempt_count, next_attempt_at, updated_at
        ) VALUES (?, ?, ?, 'PENDING', 0, ?, ?)
      `,
      envelope.projectionEventId,
      envelope.assessmentId,
      envelope.payloadHash,
      envelope.committedAt,
      envelope.committedAt)

      this.state.storage.sql.exec(`
        INSERT INTO candidate_projection_events (
          event_id, projection_event_id, previous_status, next_status,
          attempt_count, error_code, occurred_at
        ) VALUES (?, ?, NULL, 'PENDING', 0, NULL, ?)
      `,
      projectionEventId(envelope.projectionEventId, 0, 'PENDING'),
      envelope.projectionEventId,
      envelope.committedAt)

      return {
        envelope,
        replayed: false,
        outbox: {
          projection_status: 'PENDING',
          attempt_count: 0,
          next_attempt_at: envelope.committedAt,
          last_error_code: null,
        },
      }
    })
  }

  private recordProjectionSuccess(
    envelope: CandidateEvidenceEnvelope,
    previous: OutboxRow,
    occurredAt: string,
  ): OutboxRow {
    const attemptCount = previous.attempt_count + 1
    return this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`
        UPDATE candidate_projection_outbox
           SET projection_status = 'PROJECTED',
               attempt_count = ?,
               last_error_code = NULL,
               next_attempt_at = NULL,
               projected_at = ?,
               updated_at = ?
         WHERE projection_event_id = ?
           AND payload_hash = ?
           AND projection_status = 'PENDING'
      `,
      attemptCount,
      occurredAt,
      occurredAt,
      envelope.projectionEventId,
      envelope.payloadHash)

      this.state.storage.sql.exec(`
        INSERT OR IGNORE INTO candidate_projection_events (
          event_id, projection_event_id, previous_status, next_status,
          attempt_count, error_code, occurred_at
        ) VALUES (?, ?, ?, 'PROJECTED', ?, NULL, ?)
      `,
      projectionEventId(envelope.projectionEventId, attemptCount, 'PROJECTED'),
      envelope.projectionEventId,
      previous.projection_status,
      attemptCount,
      occurredAt)

      return {
        projection_status: 'PROJECTED',
        attempt_count: attemptCount,
        next_attempt_at: null,
        last_error_code: null,
      }
    })
  }

  private async recordProjectionFailure(
    envelope: CandidateEvidenceEnvelope,
    previous: OutboxRow,
    error: unknown,
    now: Date,
  ): Promise<OutboxRow> {
    const conflict = error instanceof CandidateEvidenceConflictError
    const decision = decideCandidateProjectionRetry(previous.attempt_count, conflict, now)
    const errorCode = sanitizeProjectionError(error)
    const occurredAt = now.toISOString()

    const next = this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`
        UPDATE candidate_projection_outbox
           SET projection_status = ?,
               attempt_count = ?,
               last_error_code = ?,
               next_attempt_at = ?,
               first_failed_at = COALESCE(first_failed_at, ?),
               dead_lettered_at = CASE WHEN ? = 'DEAD_LETTER' THEN ? ELSE dead_lettered_at END,
               updated_at = ?
         WHERE projection_event_id = ?
           AND payload_hash = ?
           AND projection_status = 'PENDING'
      `,
      decision.nextStatus,
      decision.attemptCount,
      errorCode,
      decision.nextAttemptAt,
      occurredAt,
      decision.nextStatus,
      occurredAt,
      occurredAt,
      envelope.projectionEventId,
      envelope.payloadHash)

      this.state.storage.sql.exec(`
        INSERT OR IGNORE INTO candidate_projection_events (
          event_id, projection_event_id, previous_status, next_status,
          attempt_count, error_code, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      projectionEventId(envelope.projectionEventId, decision.attemptCount, decision.nextStatus),
      envelope.projectionEventId,
      previous.projection_status,
      decision.nextStatus,
      decision.attemptCount,
      errorCode,
      occurredAt)

      return {
        projection_status: decision.nextStatus,
        attempt_count: decision.attemptCount,
        next_attempt_at: decision.nextAttemptAt,
        last_error_code: errorCode,
      }
    })

    await this.scheduleNextAlarm()
    return next
  }

  private async markStoredEnvelopeConflict(row: PendingProjectionRow, errorCode: string): Promise<void> {
    const occurredAt = new Date().toISOString()
    const decision = decideCandidateProjectionRetry(row.attempt_count, true, new Date(occurredAt))
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`
        UPDATE candidate_projection_outbox
           SET projection_status = 'CONFLICT',
               attempt_count = ?,
               last_error_code = ?,
               next_attempt_at = NULL,
               first_failed_at = COALESCE(first_failed_at, ?),
               updated_at = ?
         WHERE projection_event_id = ?
           AND payload_hash = ?
           AND projection_status = 'PENDING'
      `,
      decision.attemptCount,
      errorCode,
      occurredAt,
      occurredAt,
      row.projection_event_id,
      row.payload_hash)

      this.state.storage.sql.exec(`
        INSERT OR IGNORE INTO candidate_projection_events (
          event_id, projection_event_id, previous_status, next_status,
          attempt_count, error_code, occurred_at
        ) VALUES (?, ?, ?, 'CONFLICT', ?, ?, ?)
      `,
      projectionEventId(row.projection_event_id, decision.attemptCount, 'CONFLICT'),
      row.projection_event_id,
      row.projection_status,
      decision.attemptCount,
      errorCode,
      occurredAt)
    })
    await this.scheduleNextAlarm()
  }

  private async attemptProjection(envelope: CandidateEvidenceEnvelope): Promise<OutboxRow> {
    const current = this.readOutboxByProjection(envelope.projectionEventId)
    if (current.projection_status !== 'PENDING') return current

    try {
      await projectCandidateEvidenceToD1(this.env.DB, envelope)
      const projected = this.recordProjectionSuccess(envelope, current, new Date().toISOString())
      await this.scheduleNextAlarm()
      return projected
    } catch (error) {
      return this.recordProjectionFailure(envelope, current, error, new Date())
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    const row = this.state.storage.sql.exec<NextAlarmRow>(`
      SELECT MIN(next_attempt_at) AS next_attempt_at
        FROM candidate_projection_outbox
       WHERE projection_status = 'PENDING'
         AND next_attempt_at IS NOT NULL
    `).one()
    if (!row.next_attempt_at) return
    const parsed = Date.parse(row.next_attempt_at)
    if (!Number.isFinite(parsed)) return
    await this.state.storage.setAlarm(Math.max(Date.now() + 1_000, parsed))
  }

  private readDueProjections(now: string): PendingProjectionRow[] {
    return this.state.storage.sql.exec<PendingProjectionRow>(`
      SELECT o.projection_event_id,
             o.assessment_id,
             o.payload_hash,
             o.projection_status,
             o.attempt_count,
             o.next_attempt_at,
             o.last_error_code,
             a.envelope_json
        FROM candidate_projection_outbox o
        JOIN candidate_assessment_commits a
          ON a.assessment_id = o.assessment_id
       WHERE o.projection_status = 'PENDING'
         AND o.next_attempt_at IS NOT NULL
         AND o.next_attempt_at <= ?
       ORDER BY o.next_attempt_at ASC, o.projection_event_id ASC
       LIMIT ?
    `, now, MAX_ALARM_PROJECTIONS).toArray()
  }

  private async readCandidateRequest(request: Request): Promise<CandidateAssessmentRequest> {
    const declaredLength = Number(request.headers.get('content-length') ?? '0')
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      throw new RangeError('candidate evidence request exceeds size limit')
    }
    const text = await request.text()
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
      throw new RangeError('candidate evidence request exceeds size limit')
    }
    return JSON.parse(text) as CandidateAssessmentRequest
  }

  private async persistCandidateAssessment(request: Request): Promise<Response> {
    const unauthorized = this.authorizeInternal(request)
    if (unauthorized) return unauthorized

    try {
      const body = await this.readCandidateRequest(request)
      const deterministicInput: CandidateOrderAssessmentInput = {
        ...body,
        previewOptions: {
          ...body.previewOptions,
          now: () => new Date(body.decidedAt),
        },
      }
      const assessment = await assessBitgetCandidateOrder(deterministicInput)
      const base = await buildCandidateEvidenceBase(
        deterministicInput,
        assessment,
        new Date().toISOString(),
      )
      const committed = this.commitEvidence(base)
      const outbox = committed.outbox.projection_status === 'PENDING'
        ? await this.attemptProjection(committed.envelope)
        : committed.outbox

      return json({
        status: committed.envelope.status,
        executionAllowed: false,
        replayed: committed.replayed,
        authoritativeStore: 'DURABLE_OBJECT_SQLITE',
        projectionStore: 'D1',
        projectionStatus: outbox.projection_status,
        projectionAttemptCount: outbox.attempt_count,
        nextProjectionAttemptAt: outbox.next_attempt_at,
        projectionErrorCode: outbox.last_error_code,
        assessmentId: committed.envelope.assessmentId,
        projectionEventId: committed.envelope.projectionEventId,
        coordinatorSequence: committed.envelope.coordinatorSequence,
        evidenceHash: committed.envelope.evidenceHash,
        payloadHash: committed.envelope.payloadHash,
        reservationDraftPersisted: committed.envelope.reservation !== null,
      }, outbox.projection_status === 'PROJECTED' ? (committed.replayed ? 200 : 201) : 202)
    } catch (error) {
      const code = safeErrorCode(error)
      const status = error instanceof CandidateEvidenceConflictError
        ? 409
        : error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError
          ? 400
          : 500
      return json({ error: 'Candidate evidence was not persisted', code }, status)
    }
  }

  private readAssessment(request: Request, assessmentId: string): Response {
    const unauthorized = this.authorizeInternal(request)
    if (unauthorized) return unauthorized

    const row = this.state.storage.sql.exec<EnvelopeRow>(`
      SELECT envelope_json
        FROM candidate_assessment_commits
       WHERE assessment_id = ?
    `, assessmentId).toArray()[0]
    if (!row) return json({ error: 'Assessment not found', code: 'CANDIDATE_ASSESSMENT_NOT_FOUND' }, 404)

    const envelope = parseEnvelope(row.envelope_json)
    const outbox = this.readOutboxByAssessment(assessmentId)
    return json({
      envelope,
      projectionStatus: outbox.projection_status,
      projectionAttemptCount: outbox.attempt_count,
      nextProjectionAttemptAt: outbox.next_attempt_at,
      projectionErrorCode: outbox.last_error_code,
      executionAllowed: false,
    })
  }

  async alarm(): Promise<void> {
    const now = new Date().toISOString()
    for (const row of this.readDueProjections(now)) {
      try {
        const envelope = parseEnvelope(row.envelope_json)
        if (
          envelope.projectionEventId !== row.projection_event_id
          || envelope.assessmentId !== row.assessment_id
          || envelope.payloadHash !== row.payload_hash
        ) {
          await this.markStoredEnvelopeConflict(row, 'STORED_ENVELOPE_HASH_MISMATCH')
          continue
        }
        await this.attemptProjection(envelope)
      } catch {
        await this.markStoredEnvelopeConflict(row, 'STORED_ENVELOPE_INVALID')
      }
    }
    await this.scheduleNextAlarm()
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()

    if ((method === 'GET' || method === 'HEAD') && (url.pathname === '/health' || url.pathname === '/state')) {
      const response = json(this.snapshot())
      return method === 'HEAD'
        ? new Response(null, { status: response.status, headers: response.headers })
        : response
    }

    if (method === 'POST' && url.pathname === '/candidate/assessments') {
      return this.persistCandidateAssessment(request)
    }

    if (method === 'GET' && url.pathname.startsWith('/candidate/assessments/')) {
      const assessmentId = decodeURIComponent(url.pathname.slice('/candidate/assessments/'.length))
      return this.readAssessment(request, assessmentId)
    }

    return json({
      error: 'Exchange account coordinator is execution-locked',
      code: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
    }, 423)
  }
}
