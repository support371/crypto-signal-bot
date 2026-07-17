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

export interface AccountCoordinatorEnv {
  DB: D1Database
  BUILD_GIT_SHA?: string
  LIVE_EXECUTION_ENABLED?: string
  WITHDRAWALS_ENABLED?: string
  CANDIDATE_EVIDENCE_TOKEN?: string
}

interface CoordinatorMetadata {
  schemaVersion: 2
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
  projection_status: 'PENDING' | 'PROJECTED' | 'CONFLICT'
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

interface CommitResult {
  envelope: CandidateEvidenceEnvelope
  replayed: boolean
  outboxStatus: OutboxRow['projection_status']
}

const METADATA_KEY = 'coordinator:metadata'
const MAX_REQUEST_BYTES = 256 * 1024
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
      if (existing?.schemaVersion === 2) {
        this.metadata = existing
        return
      }

      const created: CoordinatorMetadata = {
        schemaVersion: 2,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        halted: true,
        haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
      }
      await this.state.storage.put(METADATA_KEY, created)
      this.metadata = created
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
          CHECK (projection_status IN ('PENDING', 'PROJECTED', 'CONFLICT')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error_code TEXT,
        projected_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (assessment_id) REFERENCES candidate_assessment_commits(assessment_id)
      );

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

  private snapshot(): Record<string, unknown> {
    const assessmentCount = this.state.storage.sql.exec<CountRow>(
      'SELECT COUNT(*) AS count FROM candidate_assessment_commits',
    ).one().count
    const pendingProjectionCount = this.state.storage.sql.exec<CountRow>(
      "SELECT COUNT(*) AS count FROM candidate_projection_outbox WHERE projection_status = 'PENDING'",
    ).one().count

    return {
      coordinatorId: this.state.id.toString(),
      schemaVersion: this.metadata?.schemaVersion ?? 2,
      createdAt: this.metadata?.createdAt ?? null,
      halted: true,
      haltReason: 'LIVE_CANDIDATE_EXECUTION_LOCKED',
      orderSubmissionEnabled: false,
      cancellationEnabled: false,
      withdrawalsEnabled: false,
      candidateEvidencePersistenceEnabled: Boolean(String(this.env.CANDIDATE_EVIDENCE_TOKEN ?? '').trim()),
      assessmentCount,
      pendingProjectionCount,
      configuredLiveFlag: String(this.env.LIVE_EXECUTION_ENABLED ?? '').toLowerCase() === 'true',
      configuredWithdrawalsFlag: String(this.env.WITHDRAWALS_ENABLED ?? '').toLowerCase() === 'true',
      buildGitSha: String(this.env.BUILD_GIT_SHA ?? ''),
    }
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
        const outbox = this.state.storage.sql.exec<OutboxRow>(`
          SELECT projection_status
            FROM candidate_projection_outbox
           WHERE assessment_id = ?
        `, envelope.assessmentId).one()
        return { envelope, replayed: true, outboxStatus: outbox.projection_status }
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
          projection_status, attempt_count, updated_at
        ) VALUES (?, ?, ?, 'PENDING', 0, ?)
      `,
      envelope.projectionEventId,
      envelope.assessmentId,
      envelope.payloadHash,
      envelope.committedAt)

      return { envelope, replayed: false, outboxStatus: 'PENDING' }
    })
  }

  private updateOutbox(
    envelope: CandidateEvidenceEnvelope,
    status: OutboxRow['projection_status'],
    errorCode: string | null,
  ): void {
    this.state.storage.transactionSync(() => {
      this.state.storage.sql.exec(`
        UPDATE candidate_projection_outbox
           SET projection_status = ?,
               attempt_count = attempt_count + 1,
               last_error_code = ?,
               projected_at = CASE WHEN ? = 'PROJECTED' THEN ? ELSE projected_at END,
               updated_at = ?
         WHERE projection_event_id = ?
           AND payload_hash = ?
      `,
      status,
      errorCode,
      status,
      new Date().toISOString(),
      new Date().toISOString(),
      envelope.projectionEventId,
      envelope.payloadHash)
    })
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

      let projectionStatus: OutboxRow['projection_status'] = committed.outboxStatus
      if (projectionStatus !== 'PROJECTED' && projectionStatus !== 'CONFLICT') {
        try {
          await projectCandidateEvidenceToD1(this.env.DB, committed.envelope)
          projectionStatus = 'PROJECTED'
          this.updateOutbox(committed.envelope, 'PROJECTED', null)
        } catch (error) {
          projectionStatus = error instanceof CandidateEvidenceConflictError ? 'CONFLICT' : 'PENDING'
          this.updateOutbox(committed.envelope, projectionStatus, sanitizeProjectionError(error))
        }
      }

      return json({
        status: committed.envelope.status,
        executionAllowed: false,
        replayed: committed.replayed,
        authoritativeStore: 'DURABLE_OBJECT_SQLITE',
        projectionStore: 'D1',
        projectionStatus,
        assessmentId: committed.envelope.assessmentId,
        projectionEventId: committed.envelope.projectionEventId,
        coordinatorSequence: committed.envelope.coordinatorSequence,
        evidenceHash: committed.envelope.evidenceHash,
        payloadHash: committed.envelope.payloadHash,
        reservationDraftPersisted: committed.envelope.reservation !== null,
      }, projectionStatus === 'PROJECTED' ? (committed.replayed ? 200 : 201) : 202)
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
    const outbox = this.state.storage.sql.exec<OutboxRow>(`
      SELECT projection_status
        FROM candidate_projection_outbox
       WHERE assessment_id = ?
    `, assessmentId).one()
    return json({ envelope, projectionStatus: outbox.projection_status, executionAllowed: false })
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
