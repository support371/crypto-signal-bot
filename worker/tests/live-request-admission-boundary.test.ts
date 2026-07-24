import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_RATE_LIMIT_RPM,
  MAX_RATE_LIMIT_RPM,
  REQUEST_ADMISSION_SQL,
  evaluateRequestAdmission,
  purgeExpiredRequestAdmissionCounters,
  requestAdmissionFailureResponse,
  type RequestAdmissionEnv,
} from '../src/request-admission-boundary.ts'

type FakeOptions = {
  firstResult?: unknown
  firstError?: Error
  runError?: Error
}

class FakeD1Database {
  readonly preparedSql: string[] = []
  readonly bindings: unknown[][] = []

  constructor(private readonly options: FakeOptions = {}) {}

  prepare(sql: string): D1PreparedStatement {
    this.preparedSql.push(sql)
    const database = this
    let currentBindings: unknown[] = []

    return {
      bind(...values: unknown[]) {
        currentBindings = values
        database.bindings.push(values)
        return this
      },
      async first<T>() {
        if (database.options.firstError) throw database.options.firstError
        return (database.options.firstResult ?? null) as T | null
      },
      async run() {
        if (database.options.runError) throw database.options.runError
        return {
          success: true,
          meta: {},
          results: [],
        } as unknown as D1Result
      },
    } as unknown as D1PreparedStatement
  }
}

function env(
  database: FakeD1Database,
  rateLimit = '2',
  origins = 'https://allowed.example',
): RequestAdmissionEnv {
  return {
    DB: database as unknown as D1Database,
    RATE_LIMIT_RPM: rateLimit,
    CORS_ALLOWED_ORIGINS: origins,
  }
}

function request(
  connectingIp = '203.0.113.10',
  origin?: string,
): Request {
  const headers = new Headers({ 'CF-Connecting-IP': connectingIp })
  if (origin) headers.set('Origin', origin)
  return new Request('https://worker.example/healthz', { headers })
}

test('migration 031 creates a bounded admission counter table', () => {
  const migrationPath = fileURLToPath(
    new URL('../migrations/031_request_admission_counters.sql', import.meta.url),
  )
  const database = new DatabaseSync(':memory:')
  database.exec(fs.readFileSync(migrationPath, 'utf8'))

  const columns = database
    .prepare('PRAGMA table_info(request_admission_counters)')
    .all() as Array<{ name: string; pk: number }>

  assert.deepEqual(
    columns.map((column) => column.name),
    ['bucket', 'count', 'expires_at'],
  )
  assert.equal(columns.find((column) => column.name === 'bucket')?.pk, 1)

  const indexes = database
    .prepare("PRAGMA index_list('request_admission_counters')")
    .all() as Array<{ name: string }>
  assert.ok(indexes.some((index) => index.name === 'request_admission_counters_expires_at_idx'))
})

test('admission uses one conditional atomic UPSERT and permits a bounded request', async () => {
  const database = new FakeD1Database({ firstResult: { count: 1 } })
  const result = await evaluateRequestAdmission(request(), env(database), 120_000)

  assert.deepEqual(result, {
    status: 'allowed',
    limit: 2,
    count: 1,
    remaining: 1,
  })
  assert.equal(database.preparedSql.length, 1)
  assert.equal(database.preparedSql[0], REQUEST_ADMISSION_SQL)
  assert.match(REQUEST_ADMISSION_SQL, /ON CONFLICT\(bucket\) DO UPDATE/)
  assert.match(REQUEST_ADMISSION_SQL, /WHERE request_admission_counters\.count < \?3/)
  assert.match(REQUEST_ADMISSION_SQL, /RETURNING count/)
  assert.deepEqual(database.bindings[0], ['203.0.113.10:2', 240_000, 2])
})

test('a conditional UPSERT with no returned row is rate limited', async () => {
  const database = new FakeD1Database({ firstResult: null })
  const result = await evaluateRequestAdmission(request(), env(database), 120_000)

  assert.deepEqual(result, { status: 'limited', limit: 2 })
})

test('D1 or schema failure returns unavailable instead of allowing the request', async () => {
  const database = new FakeD1Database({ firstError: new Error('sensitive storage detail') })
  const result = await evaluateRequestAdmission(request(), env(database), 120_000)

  assert.deepEqual(result, { status: 'unavailable' })
})

test('invalid D1 count evidence fails closed', async () => {
  const database = new FakeD1Database({ firstResult: { count: Number.NaN } })
  const result = await evaluateRequestAdmission(request(), env(database), 120_000)

  assert.deepEqual(result, { status: 'unavailable' })
})

test('rate limit configuration has safe defaults and an upper bound', async () => {
  const defaultDatabase = new FakeD1Database({ firstResult: { count: 1 } })
  const defaultResult = await evaluateRequestAdmission(
    request(),
    env(defaultDatabase, 'invalid'),
    120_000,
  )
  assert.equal(defaultResult.status === 'allowed' && defaultResult.limit, DEFAULT_RATE_LIMIT_RPM)

  const cappedDatabase = new FakeD1Database({ firstResult: { count: 1 } })
  const cappedResult = await evaluateRequestAdmission(
    request(),
    env(cappedDatabase, '999999999'),
    120_000,
  )
  assert.equal(cappedResult.status === 'allowed' && cappedResult.limit, MAX_RATE_LIMIT_RPM)
})

test('missing connecting IPs share one bounded unknown-client bucket', async () => {
  const database = new FakeD1Database({ firstResult: { count: 1 } })
  const noIpRequest = new Request('https://worker.example/healthz')

  await evaluateRequestAdmission(noIpRequest, env(database), 120_000)

  assert.deepEqual(database.bindings[0], ['unknown:2', 240_000, 2])
})

test('failure responses are generic, no-store, and only reflect allowed CORS origins', async () => {
  const allowedRequest = request('203.0.113.10', 'https://allowed.example')
  const unavailable = requestAdmissionFailureResponse(
    allowedRequest,
    env(new FakeD1Database()),
    { status: 'unavailable' },
  )
  assert.equal(unavailable.status, 503)
  assert.equal(unavailable.headers.get('Cache-Control'), 'no-store')
  assert.equal(unavailable.headers.get('Retry-After'), '5')
  assert.equal(unavailable.headers.get('Access-Control-Allow-Origin'), 'https://allowed.example')
  const unavailableBody = await unavailable.text()
  assert.match(unavailableBody, /REQUEST_ADMISSION_UNAVAILABLE/)
  assert.doesNotMatch(unavailableBody, /sensitive|storage|schema|D1/i)

  const deniedOrigin = requestAdmissionFailureResponse(
    request('203.0.113.10', 'https://attacker.example'),
    env(new FakeD1Database()),
    { status: 'limited', limit: 2 },
  )
  assert.equal(deniedOrigin.status, 429)
  assert.equal(deniedOrigin.headers.get('Retry-After'), '60')
  assert.equal(deniedOrigin.headers.get('Access-Control-Allow-Origin'), null)
})

test('scheduled cleanup removes expired admission buckets without throwing', async () => {
  const successDatabase = new FakeD1Database()
  assert.equal(
    await purgeExpiredRequestAdmissionCounters(env(successDatabase), 300_000),
    true,
  )
  assert.match(successDatabase.preparedSql[0] ?? '', /DELETE FROM request_admission_counters/)
  assert.deepEqual(successDatabase.bindings[0], [300_000])

  const failedDatabase = new FakeD1Database({ runError: new Error('offline') })
  assert.equal(
    await purgeExpiredRequestAdmissionCounters(env(failedDatabase), 300_000),
    false,
  )
})
