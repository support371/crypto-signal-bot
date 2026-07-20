import assert from 'node:assert/strict'
import test from 'node:test'

import {
  OPERATIONAL_REHEARSAL_SCENARIOS,
  type OperationalRehearsalInput,
  type OperationalScenarioInput,
} from '../src/live/demo-operational-rehearsal.ts'
import {
  OperationalRehearsalStoreError,
  recordOperationalRehearsal,
} from '../src/live/demo-operational-rehearsal-store.ts'

const locks = Object.freeze({
  deploymentAllowed: false as const,
  demoRequestAllowed: false as const,
  credentialsRead: false as const,
  credentialsPersisted: false as const,
  providerMutationAllowed: false as const,
  executionAllowed: false as const,
  liveExecutionAllowed: false as const,
  realFundsAllowed: false as const,
  mainnetAllowed: false as const,
  withdrawalsAllowed: false as const,
  automaticRetryAllowed: false as const,
  accountingAutomaticallyDispatched: false as const,
})

function scenario(hash: string): OperationalScenarioInput {
  return Object.freeze({
    passed: true,
    evidenceHash: hash,
    observedAt: '2026-07-19T18:00:00.000Z',
    ...locks,
  })
}

function input(): OperationalRehearsalInput {
  return {
    packId: 'operational-rehearsal-0001',
    gitSha: 'b'.repeat(40),
    scenarios: Object.freeze(Object.fromEntries(
      OPERATIONAL_REHEARSAL_SCENARIOS.map((name, index) => [
        name,
        scenario((index + 1).toString(16).repeat(64)),
      ]),
    )) as OperationalRehearsalInput['scenarios'],
    preparedBy: 'operations-reviewer-0001',
    preparedAt: '2026-07-19T18:01:00.000Z',
  }
}

class FakeD1 {
  rows: Record<string, unknown>[] = []

  prepare(sql: string): D1PreparedStatement {
    const database = this
    let values: unknown[] = []
    const statement = {
      bind(...next: unknown[]) {
        values = next
        return statement
      },
      async first<T>(): Promise<T | null> {
        if (!sql.includes('FROM live_bitget_demo_operational_rehearsal_packs')) return null
        const [packId, packHash] = values.map(String)
        return (database.rows.find((row) => (
          row.pack_id === packId || row.pack_hash === packHash
        )) ?? null) as T | null
      },
      async all<T>(): Promise<D1Result<T>> {
        return { results: [] } as D1Result<T>
      },
      async run(): Promise<D1Result> {
        if (!sql.includes('INSERT INTO live_bitget_demo_operational_rehearsal_packs')) {
          return {} as D1Result
        }
        if (database.rows.length > 0) throw new Error('unique conflict')
        database.rows.push({
          pack_id: String(values[0]),
          git_sha: String(values[1]),
          environment: 'BITGET_DEMO_CERTIFICATION',
          scenarios_json: String(values[2]),
          scenario_count: 5,
          passed_count: Number(values[3]),
          blockers_json: String(values[4]),
          status: String(values[5]),
          ready_for_independent_review: Number(values[6]),
          pack_hash: String(values[7]),
          prepared_by: String(values[8]),
          prepared_at: String(values[9]),
          deployment_allowed: 0,
          demo_request_allowed: 0,
          credentials_read: 0,
          credentials_persisted: 0,
          provider_mutation_allowed: 0,
          execution_allowed: 0,
          live_execution_allowed: 0,
          real_funds_allowed: 0,
          mainnet_allowed: 0,
          withdrawals_allowed: 0,
          automatic_retry_allowed: 0,
          accounting_automatically_dispatched: 0,
        })
        return {} as D1Result
      },
    }
    return statement as unknown as D1PreparedStatement
  }

  env() {
    return { DB: this as unknown as D1Database }
  }
}

test('store projects once and exactly replays', async () => {
  const database = new FakeD1()
  const first = await recordOperationalRehearsal(database.env(), input())
  const replay = await recordOperationalRehearsal(database.env(), input())
  assert.equal(first.projectionStatus, 'PROJECTED')
  assert.equal(replay.projectionStatus, 'REPLAYED')
  assert.equal(replay.packHash, first.packHash)
  assert.equal(database.rows.length, 1)
})

test('changed evidence conflicts with the same pack identity', async () => {
  const database = new FakeD1()
  const original = input()
  await recordOperationalRehearsal(database.env(), original)
  const changed = {
    ...original.scenarios,
    ROLLBACK_TO_KNOWN_GOOD: scenario('f'.repeat(64)),
  }
  await assert.rejects(
    recordOperationalRehearsal(database.env(), {
      ...original,
      scenarios: Object.freeze(changed),
    }),
    OperationalRehearsalStoreError,
  )
})

test('stored capability corruption is rejected', async () => {
  const database = new FakeD1()
  await recordOperationalRehearsal(database.env(), input())
  database.rows[0]!.deployment_allowed = 1
  await assert.rejects(
    recordOperationalRehearsal(database.env(), input()),
    /capability locks are invalid/,
  )
})
