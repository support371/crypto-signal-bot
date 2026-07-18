import assert from 'node:assert/strict'
import test from 'node:test'

import {
  certifyBitgetReadOnlyContracts,
  type BitgetReadOnlyCertificationClient,
  type BitgetReadOnlyCertificationResult,
} from '../src/live/bitget-read-only-certification.ts'
import {
  BitgetReadOnlyCertificationConflictError,
  persistBitgetReadOnlyCertification,
  type BitgetReadOnlyCertificationStoreEnv,
} from '../src/live/bitget-read-only-certification-store.ts'
import {
  BITGET_SPOT_ENDPOINTS,
  type BitgetReadOnlyEndpoint,
} from '../src/live/adapters/bitget/endpoints.ts'

class FixtureClient implements BitgetReadOnlyCertificationClient {
  quoteAvailable = '1000'

  async verifyReadOnlyPermissions() {
    return {
      userId: 'fixture-user',
      authorities: Object.freeze(['readonly']),
      readOnly: true,
    }
  }

  async request(endpoint: BitgetReadOnlyEndpoint): Promise<unknown> {
    assert.equal(endpoint, BITGET_SPOT_ENDPOINTS.symbols)
    return {
      code: '00000',
      data: [{
        symbol: 'BTCUSDT',
        baseCoin: 'BTC',
        quoteCoin: 'USDT',
        status: 'online',
        quantityPrecision: '8',
        quotePrecision: '2',
        pricePrecision: '2',
        minTradeAmount: '0.0001',
        maxTradeAmount: '10',
        minTradeUSDT: '5',
        lastPr: '50000',
      }],
    }
  }

  async listAccountAssets(): Promise<unknown> {
    return {
      code: '00000',
      data: [
        { coin: 'BTC', available: '1', frozen: '0', locked: '0', uTime: '1784336400000' },
        { coin: 'USDT', available: this.quoteAvailable, frozen: '0', locked: '0', uTime: '1784336400000' },
      ],
    }
  }

  async listCurrentOrders(): Promise<unknown> {
    return { code: '00000', data: { orderList: [] } }
  }

  async listHistoryOrders(): Promise<unknown> {
    return { code: '00000', data: { orderList: [] } }
  }

  async listFills(): Promise<unknown> {
    return { code: '00000', data: { fillList: [] } }
  }
}

async function certification(
  runId = 'read-cert-store-1',
  client = new FixtureClient(),
): Promise<BitgetReadOnlyCertificationResult> {
  return certifyBitgetReadOnlyContracts({
    runId,
    exchangeAccountId: 'bitget-account-ref',
    productId: 'BTC-USDT',
    baseAsset: 'BTC',
    quoteAsset: 'USDT',
    windowStartMs: 1784332800000,
    windowEndMs: 1784336460000,
    observedAt: '2026-07-18T00:59:00.000Z',
    productExpiresAt: '2026-07-18T01:05:00.000Z',
    evaluatedAt: '2026-07-18T01:00:00.000Z',
    client,
  })
}

type RunRow = Record<string, unknown> & { run_id: string; evidence_hash: string }
type CheckRow = Record<string, unknown> & { run_id: string; check_name: string }

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
}

class FakeD1 {
  run: RunRow | null = null
  checks = new Map<string, CheckRow>()
  batches: FakeStatement[][] = []

  prepare(sql: string): D1PreparedStatement {
    return new FakeStatement(this, sql) as unknown as D1PreparedStatement
  }

  first(sql: string, params: unknown[]): unknown {
    if (!sql.includes('FROM live_bitget_read_only_certification_runs')) return null
    if (!this.run) return null
    const runId = String(params[0])
    const evidenceHash = String(params[1])
    return this.run.run_id === runId || this.run.evidence_hash === evidenceHash
      ? this.run
      : null
  }

  all(sql: string, params: unknown[]): CheckRow[] {
    if (!sql.includes('FROM live_bitget_read_only_certification_checks')) return []
    const runId = String(params[0])
    return [...this.checks.values()]
      .filter((row) => row.run_id === runId)
      .sort((left, right) => left.check_name.localeCompare(right.check_name))
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const bound = statements as unknown as FakeStatement[]
    this.batches.push(bound)
    for (const statement of bound) {
      const params = statement.params
      if (statement.sql.includes('INSERT INTO live_bitget_read_only_certification_runs')) {
        this.run = {
          run_id: String(params[0]),
          provider: 'BITGET',
          exchange_account_id: String(params[1]),
          product_id: String(params[2]),
          status: String(params[3]),
          read_only_evidence_complete: Number(params[4]),
          permissions_verified: Number(params[5]),
          product_count: Number(params[6]),
          balance_count: Number(params[7]),
          current_order_count: Number(params[8]),
          history_order_count: Number(params[9]),
          fill_count: Number(params[10]),
          duplicate_order_count: Number(params[11]),
          duplicate_fill_count: Number(params[12]),
          evaluated_at: String(params[13]),
          evidence_hash: String(params[14]),
          certified_for_live: 0,
          provider_mutation_allowed: 0,
          automatic_retry_allowed: 0,
          transfer_allowed: 0,
          withdrawal_allowed: 0,
          execution_allowed: 0,
          credentials_persisted: 0,
        }
      } else if (statement.sql.includes('INSERT INTO live_bitget_read_only_certification_checks')) {
        const row: CheckRow = {
          run_id: String(params[0]),
          check_name: String(params[1]),
          status: String(params[2]),
          reason: params[3] === null ? null : String(params[3]),
          evidence_hash: String(params[4]),
        }
        this.checks.set(`${row.run_id}:${row.check_name}`, row)
      }
    }
    return []
  }

  env(): BitgetReadOnlyCertificationStoreEnv {
    return { DB: this as unknown as D1Database }
  }
}

test('certification run and eight checks persist in one D1 batch', async () => {
  const database = new FakeD1()
  const evidence = await certification()
  const result = await persistBitgetReadOnlyCertification(database.env(), evidence)

  assert.equal(result.persistenceStatus, 'PROJECTED')
  assert.equal(result.certificationStatus, 'PASSED')
  assert.equal(result.readOnlyEvidenceComplete, true)
  assert.equal(result.certifiedForLive, false)
  assert.equal(result.providerMutationAllowed, false)
  assert.equal(result.executionAllowed, false)
  assert.equal(database.batches.length, 1)
  assert.equal(database.batches[0]?.length, 9)
  assert.equal(database.checks.size, 8)
  assert.equal(database.run?.evidence_hash, evidence.evidenceHash)
})

test('identical evidence replays without another D1 batch', async () => {
  const database = new FakeD1()
  const evidence = await certification()
  await persistBitgetReadOnlyCertification(database.env(), evidence)
  const replay = await persistBitgetReadOnlyCertification(database.env(), evidence)

  assert.equal(replay.persistenceStatus, 'REPLAYED')
  assert.equal(database.batches.length, 1)
})

test('same run ID with different valid evidence is rejected', async () => {
  const database = new FakeD1()
  await persistBitgetReadOnlyCertification(database.env(), await certification())
  const changedClient = new FixtureClient()
  changedClient.quoteAvailable = '999'
  const changed = await certification('read-cert-store-1', changedClient)

  await assert.rejects(
    persistBitgetReadOnlyCertification(database.env(), changed),
    BitgetReadOnlyCertificationConflictError,
  )
  assert.equal(database.batches.length, 1)
})

test('tampered evidence hash is rejected before persistence', async () => {
  const database = new FakeD1()
  const evidence = await certification()
  const tampered = { ...evidence, evidenceHash: 'f'.repeat(64) }

  await assert.rejects(
    persistBitgetReadOnlyCertification(database.env(), tampered),
    /evidence hash is invalid/,
  )
  assert.equal(database.batches.length, 0)
})

test('missing mandatory checks are rejected', async () => {
  const database = new FakeD1()
  const evidence = await certification()
  const invalid = {
    ...evidence,
    checks: evidence.checks.slice(0, 7),
  } as BitgetReadOnlyCertificationResult

  await assert.rejects(
    persistBitgetReadOnlyCertification(database.env(), invalid),
    /exactly eight checks/,
  )
})

test('stored capability corruption is rejected on replay', async () => {
  const database = new FakeD1()
  const evidence = await certification()
  await persistBitgetReadOnlyCertification(database.env(), evidence)
  assert.ok(database.run)
  database.run.execution_allowed = 1

  await assert.rejects(
    persistBitgetReadOnlyCertification(database.env(), evidence),
    /stored Bitget read-only certification violates permanent capability locks/,
  )
})

test('stored incomplete check set is quarantined on replay', async () => {
  const database = new FakeD1()
  const evidence = await certification()
  await persistBitgetReadOnlyCertification(database.env(), evidence)
  database.checks.delete(`${evidence.runId}:FILL_CONTRACT`)

  await assert.rejects(
    persistBitgetReadOnlyCertification(database.env(), evidence),
    /checks are incomplete/,
  )
})
