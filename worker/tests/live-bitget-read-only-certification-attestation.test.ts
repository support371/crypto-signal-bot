import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attestBitgetReadOnlyCertificationSource,
  BitgetReadOnlyCertificationAttestationConflictError,
  type BitgetReadOnlyCertificationAttestationEnv,
  type BitgetReadOnlyCertificationAttestationInput,
} from '../src/live/bitget-read-only-certification-attestation.ts'

type RunRow = Record<string, unknown> & { run_id: string }
type CheckRow = Record<string, unknown> & { check_name: string; status: string }
type AttestationRow = Record<string, unknown> & { attestation_id: string; run_id: string; source_mode: string }

class FakeStatement {
  readonly database: FakeD1
  readonly sql: string
  readonly params: unknown[]

  constructor(database: FakeD1, sql: string, params: unknown[] = []) {
    this.database = database
    this.sql = sql
    this.params = params
  }

  bind(...params: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.database, this.sql, params) as unknown as D1PreparedStatement
  }

  first<T>(): Promise<T | null> {
    return Promise.resolve(this.database.first(this.sql, this.params) as T | null)
  }

  all<T>(): Promise<D1Result<T>> {
    return Promise.resolve({ results: this.database.all(this.sql, this.params) } as D1Result<T>)
  }

  run(): Promise<D1Result> {
    this.database.run(this.sql, this.params)
    return Promise.resolve({} as D1Result)
  }
}

class FakeD1 {
  runRow: RunRow = {
    run_id: 'read-cert-run-1',
    provider: 'BITGET',
    status: 'PASSED',
    read_only_evidence_complete: 1,
    permissions_verified: 1,
    evidence_hash: 'a'.repeat(64),
    certified_for_live: 0,
    provider_mutation_allowed: 0,
    automatic_retry_allowed: 0,
    transfer_allowed: 0,
    withdrawal_allowed: 0,
    execution_allowed: 0,
    credentials_persisted: 0,
  }
  checkRows: CheckRow[] = [
    'BALANCE_CONTRACT',
    'CURRENT_ORDER_CONTRACT',
    'FILL_CONTRACT',
    'ORDER_HISTORY_CONTRACT',
    'PAGINATION_BOUNDARY',
    'PRODUCT_CONTRACT',
    'READ_ONLY_PERMISSIONS',
    'RECOVERY_IDENTITY_CONSISTENCY',
  ].map((name, index) => ({
    check_name: name,
    status: 'PASS',
    evidence_hash: String(index + 1).padStart(64, '0'),
  }))
  attestations: AttestationRow[] = []
  insertCount = 0

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string, params: unknown[]): unknown {
    if (sql.includes('FROM live_bitget_read_only_certification_runs')) {
      return this.runRow.run_id === String(params[0]) ? this.runRow : null
    }
    if (sql.includes('FROM live_bitget_read_only_certification_attestations')) {
      const attestationId = String(params[0])
      const runId = String(params[1])
      const sourceMode = String(params[2])
      return this.attestations.find((row) =>
        row.attestation_id === attestationId
        || (row.run_id === runId && row.source_mode === sourceMode)) ?? null
    }
    return null
  }

  all(sql: string, params: unknown[]): CheckRow[] {
    if (!sql.includes('FROM live_bitget_read_only_certification_checks')) return []
    return this.runRow.run_id === String(params[0]) ? [...this.checkRows] : []
  }

  run(sql: string, params: unknown[]): void {
    if (!sql.includes('INSERT INTO live_bitget_read_only_certification_attestations')) return
    this.insertCount += 1
    this.attestations.push({
      attestation_id: String(params[0]),
      run_id: String(params[1]),
      run_evidence_hash: String(params[2]),
      source_mode: String(params[3]),
      environment: String(params[4]),
      source_ref: String(params[5]),
      operator_actor_id: params[6] === null ? null : String(params[6]),
      authorization_event_hash: params[7] === null ? null : String(params[7]),
      attested_at: String(params[8]),
      attestation_hash: String(params[9]),
      external_read_only_evidence: Number(params[10]),
      certification_check_projection_allowed: 0,
      certified_for_live: 0,
      provider_mutation_allowed: 0,
      automatic_retry_allowed: 0,
      transfer_allowed: 0,
      withdrawal_allowed: 0,
      execution_allowed: 0,
      credentials_persisted: 0,
    })
  }

  env(): BitgetReadOnlyCertificationAttestationEnv {
    return { DB: this as unknown as D1Database }
  }
}

function fixtureInput(
  overrides: Partial<BitgetReadOnlyCertificationAttestationInput> = {},
): BitgetReadOnlyCertificationAttestationInput {
  return {
    attestationId: 'attestation-fixture-1',
    runId: 'read-cert-run-1',
    sourceMode: 'INJECTED_FIXTURES',
    environment: 'LOCAL_TEST',
    sourceRef: 'circleci:worker-provider-tests:fixture-run',
    operatorActorId: null,
    authorizationEventHash: null,
    attestedAt: '2026-07-18T01:40:00.000Z',
    ...overrides,
  }
}

function isolatedInput(
  overrides: Partial<BitgetReadOnlyCertificationAttestationInput> = {},
): BitgetReadOnlyCertificationAttestationInput {
  return {
    attestationId: 'attestation-isolated-1',
    runId: 'read-cert-run-1',
    sourceMode: 'ISOLATED_READ_ONLY_CLIENT',
    environment: 'SHADOW',
    sourceRef: 'isolated-run:bitget-read-only:001',
    operatorActorId: 'eligible-operator-1',
    authorizationEventHash: 'b'.repeat(64),
    attestedAt: '2026-07-18T01:41:00.000Z',
    ...overrides,
  }
}

test('fixture evidence is labeled local and never external', async () => {
  const database = new FakeD1()
  const result = await attestBitgetReadOnlyCertificationSource(
    database.env(),
    fixtureInput(),
  )

  assert.equal(result.persistenceStatus, 'PROJECTED')
  assert.equal(result.sourceMode, 'INJECTED_FIXTURES')
  assert.equal(result.environment, 'LOCAL_TEST')
  assert.equal(result.externalReadOnlyEvidence, false)
  assert.equal(result.certificationCheckProjectionAllowed, false)
  assert.equal(result.certifiedForLive, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(result.credentialsPersisted, false)
  assert.match(result.attestationHash, /^[a-f0-9]{64}$/)
})

test('authorized isolated client evidence is external but cannot auto-project', async () => {
  const database = new FakeD1()
  const result = await attestBitgetReadOnlyCertificationSource(
    database.env(),
    isolatedInput(),
  )

  assert.equal(result.sourceMode, 'ISOLATED_READ_ONLY_CLIENT')
  assert.equal(result.environment, 'SHADOW')
  assert.equal(result.externalReadOnlyEvidence, true)
  assert.equal(result.certificationCheckProjectionAllowed, false)
  assert.equal(result.certifiedForLive, false)
  assert.equal(result.automaticRetryAllowed, false)
  assert.equal(result.transferAllowed, false)
  assert.equal(result.withdrawalAllowed, false)
})

test('isolated evidence requires a passed complete run with eight passing checks', async () => {
  const database = new FakeD1()
  database.checkRows[0] = { ...database.checkRows[0], status: 'BLOCKED' }
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), isolatedInput()),
    /incomplete, blocked, or failed/,
  )

  database.checkRows[0] = { ...database.checkRows[0], status: 'PASS' }
  database.checkRows.pop()
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), isolatedInput()),
    /incomplete, blocked, or failed/,
  )
})

test('fixture and isolated environment rules cannot be crossed', async () => {
  const database = new FakeD1()
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), fixtureInput({
      environment: 'SHADOW',
    })),
    /fixture certification evidence must remain LOCAL_TEST/,
  )
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), isolatedInput({
      environment: 'LOCAL_TEST',
    })),
    /cannot use LOCAL_TEST/,
  )
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), isolatedInput({
      authorizationEventHash: null,
    })),
    /authorizationEventHash is required/,
  )
})

test('identical attestation replays without another insert', async () => {
  const database = new FakeD1()
  const input = isolatedInput()
  await attestBitgetReadOnlyCertificationSource(database.env(), input)
  const replay = await attestBitgetReadOnlyCertificationSource(database.env(), input)
  assert.equal(replay.persistenceStatus, 'REPLAYED')
  assert.equal(database.insertCount, 1)
})

test('same run and source mode cannot be re-attested with changed evidence', async () => {
  const database = new FakeD1()
  await attestBitgetReadOnlyCertificationSource(database.env(), isolatedInput())
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), isolatedInput({
      attestationId: 'attestation-isolated-2',
      sourceRef: 'isolated-run:changed',
    })),
    BitgetReadOnlyCertificationAttestationConflictError,
  )
})

test('stored run and attestation capability corruption is rejected', async () => {
  const database = new FakeD1()
  database.runRow.execution_allowed = 1
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), fixtureInput()),
    /run violates permanent capability locks/,
  )

  database.runRow.execution_allowed = 0
  const input = fixtureInput()
  await attestBitgetReadOnlyCertificationSource(database.env(), input)
  database.attestations[0].certification_check_projection_allowed = 1
  await assert.rejects(
    attestBitgetReadOnlyCertificationSource(database.env(), input),
    /attestation violates permanent capability locks/,
  )
})
