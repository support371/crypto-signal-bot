import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authenticateOperatorRead,
  constantTimeHexEqual,
  parseOperatorKeyHashes,
  roleMatchesReadScope,
  sha256Hex,
  type OperatorReadAuthEnv,
} from '../src/live/operator-read-auth.ts'
import type { ScopedRole } from '../src/live/authorization.ts'

type RoleRow = {
  role: string
  scope_type: string
  scope_key: string
  expires_at: string | null
  revoked_at: string | null
}

class FakeStatement {
  private values: unknown[] = []

  constructor(private readonly rows: readonly RoleRow[]) {}

  bind(...values: unknown[]): FakeStatement {
    this.values = values
    return this
  }

  async all<T>(): Promise<{ results: T[] }> {
    assert.equal(typeof this.values[0], 'string')
    return { results: this.rows as T[] }
  }
}

function env(rows: readonly RoleRow[], keyHashes?: string): OperatorReadAuthEnv {
  return {
    OPERATOR_API_KEY_HASHES: keyHashes,
    DB: {
      prepare(sql: string) {
        assert.match(sql, /FROM live_actor_roles/)
        return new FakeStatement(rows)
      },
    } as unknown as D1Database,
  }
}

function role(overrides: Partial<ScopedRole> = {}): ScopedRole {
  return {
    role: 'AUDITOR',
    scopeType: 'GLOBAL',
    scopeKey: 'global',
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  }
}

test('operator key mapping accepts only actor IDs bound to SHA-256 hashes', () => {
  const hash = 'a'.repeat(64)
  assert.deepEqual(parseOperatorKeyHashes(JSON.stringify({ alice: hash })), { alice: hash })
  assert.deepEqual(parseOperatorKeyHashes('{bad json'), {})
  assert.deepEqual(parseOperatorKeyHashes(JSON.stringify({ alice: 'plaintext', '': hash })), {})
})

test('operator secrets are hashed and compared without early character exit', async () => {
  const hash = await sha256Hex('operator-secret')
  assert.match(hash, /^[a-f0-9]{64}$/)
  assert.equal(constantTimeHexEqual(hash, hash), true)
  assert.equal(constantTimeHexEqual(hash, `${hash.slice(0, -1)}0`), false)
  assert.equal(constantTimeHexEqual(hash, 'abc'), false)
})

test('roles must be active, allowed for the resource, and in scope', () => {
  const evaluatedAt = '2026-07-18T12:00:00.000Z'
  assert.equal(roleMatchesReadScope(role(), {
    resource: 'ACTIVATION_GATE',
    exchangeName: null,
    exchangeAccountId: null,
  }, evaluatedAt), true)

  assert.equal(roleMatchesReadScope(role({
    role: 'VIEWER',
    scopeType: 'EXCHANGE',
    scopeKey: 'BITGET',
  }), {
    resource: 'CERTIFICATION',
    exchangeName: 'BITGET',
    exchangeAccountId: 'account-1',
  }, evaluatedAt), true)

  assert.equal(roleMatchesReadScope(role({
    role: 'VIEWER',
    scopeType: 'ACCOUNT',
    scopeKey: 'account-1',
  }), {
    resource: 'ALERTS',
    exchangeName: 'BITGET',
    exchangeAccountId: 'account-1',
  }, evaluatedAt), true)

  assert.equal(roleMatchesReadScope(role({ role: 'TRADER' }), {
    resource: 'CERTIFICATION',
    exchangeName: 'BITGET',
    exchangeAccountId: 'account-1',
  }, evaluatedAt), false)
  assert.equal(roleMatchesReadScope(role({ expiresAt: evaluatedAt }), {
    resource: 'AUDIT_HEAD',
    exchangeName: 'BITGET',
    exchangeAccountId: 'account-1',
  }, evaluatedAt), false)
  assert.equal(roleMatchesReadScope(role({ revokedAt: '2026-07-18T11:00:00.000Z' }), {
    resource: 'AUDIT_HEAD',
    exchangeName: 'BITGET',
    exchangeAccountId: 'account-1',
  }, evaluatedAt), false)
})

test('operator authentication fails closed when configuration is absent', async () => {
  const result = await authenticateOperatorRead(
    env([]),
    new Request('https://candidate.example/v1/operator/activation-gate'),
    { resource: 'ACTIVATION_GATE', exchangeName: null, exchangeAccountId: null },
  )
  assert.deepEqual(result, {
    status: 'NOT_CONFIGURED',
    code: 'OPERATOR_AUTH_NOT_CONFIGURED',
  })
})

test('operator authentication rejects a wrong secret without loading authority', async () => {
  const expectedHash = await sha256Hex('correct-secret')
  const result = await authenticateOperatorRead(
    env([], JSON.stringify({ alice: expectedHash })),
    new Request('https://candidate.example/v1/operator/certification', {
      headers: { 'X-Operator-Id': 'alice', 'X-API-Key': 'wrong-secret' },
    }),
    { resource: 'CERTIFICATION', exchangeName: 'BITGET', exchangeAccountId: 'account-1' },
  )
  assert.deepEqual(result, {
    status: 'UNAUTHENTICATED',
    code: 'OPERATOR_AUTHENTICATION_FAILED',
  })
})

test('valid credentials without an allowed scoped role are forbidden', async () => {
  const expectedHash = await sha256Hex('correct-secret')
  const result = await authenticateOperatorRead(
    env([{
      role: 'TRADER',
      scope_type: 'GLOBAL',
      scope_key: 'global',
      expires_at: null,
      revoked_at: null,
    }], JSON.stringify({ alice: expectedHash })),
    new Request('https://candidate.example/v1/operator/certification', {
      headers: { 'X-Operator-Id': 'alice', Authorization: 'Bearer correct-secret' },
    }),
    { resource: 'CERTIFICATION', exchangeName: 'BITGET', exchangeAccountId: 'account-1' },
  )
  assert.deepEqual(result, {
    status: 'FORBIDDEN',
    code: 'OPERATOR_READ_FORBIDDEN',
  })
})

test('valid credentials and account-scoped authority produce a minimal principal', async () => {
  const expectedHash = await sha256Hex('correct-secret')
  const result = await authenticateOperatorRead(
    env([{
      role: 'AUDITOR',
      scope_type: 'ACCOUNT',
      scope_key: 'account-1',
      expires_at: null,
      revoked_at: null,
    }], JSON.stringify({ alice: expectedHash })),
    new Request('https://candidate.example/v1/operator/audit-head', {
      headers: { 'X-Operator-Id': 'alice', 'X-API-Key': 'correct-secret' },
    }),
    { resource: 'AUDIT_HEAD', exchangeName: 'BITGET', exchangeAccountId: 'account-1' },
    '2026-07-18T12:00:00.000Z',
  )

  assert.equal(result.status, 'AUTHORIZED')
  if (result.status !== 'AUTHORIZED') return
  assert.equal(result.principal.actorId, 'alice')
  assert.deepEqual(result.principal.matchedRoles, ['AUDITOR'])
  assert.equal(result.principal.roles.length, 1)
})
