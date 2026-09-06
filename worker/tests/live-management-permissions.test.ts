import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bearerAssuranceLevel,
  hasPrivilegedAssurance,
  permissionsForRoles,
  type ManagementRole,
  type ManagementScopeType,
} from '../src/management.ts'

function roles(
  values: ManagementRole[],
  scope_type: ManagementScopeType = 'GLOBAL',
  scope_key = 'global',
) {
  return values.map((role) => ({ role, scope_type, scope_key }))
}

test('viewer has no administrative management authority', () => {
  const permissions = permissionsForRoles(roles(['VIEWER']))
  assert.equal(permissions.canReadAdmin, false)
  assert.equal(permissions.canManageUsers, false)
  assert.equal(permissions.canManageAccess, false)
})

test('auditor can inspect audit and usage but cannot mutate users', () => {
  const permissions = permissionsForRoles(roles(['AUDITOR']))
  assert.equal(permissions.canReadAdmin, true)
  assert.equal(permissions.canViewAudit, true)
  assert.equal(permissions.canViewUsage, true)
  assert.equal(permissions.canManageUsers, false)
})

test('risk admin can inspect and manage system but cannot grant roles', () => {
  const permissions = permissionsForRoles(roles(['RISK_ADMIN']))
  assert.equal(permissions.canReadAdmin, true)
  assert.equal(permissions.canManageSystem, true)
  assert.equal(permissions.canManageAccess, false)
})

test('release admin is the sole management role with user and access mutation authority', () => {
  const permissions = permissionsForRoles(roles(['RELEASE_ADMIN']))
  assert.equal(permissions.canReadAdmin, true)
  assert.equal(permissions.canManageUsers, true)
  assert.equal(permissions.canManageAccess, true)
  assert.equal(permissions.canViewAudit, true)
  assert.equal(permissions.canViewUsage, true)
})

test('account and exchange scoped roles never become global management authority', () => {
  for (const scoped of [
    roles(['RELEASE_ADMIN'], 'ACCOUNT', 'portfolio-1'),
    roles(['RELEASE_ADMIN'], 'EXCHANGE', 'btcc'),
    roles(['AUDITOR'], 'ACCOUNT', 'portfolio-1'),
  ]) {
    const permissions = permissionsForRoles(scoped)
    assert.equal(permissions.canReadAdmin, false)
    assert.equal(permissions.canManageUsers, false)
    assert.equal(permissions.canManageAccess, false)
    assert.equal(permissions.canViewAudit, false)
  }
})

function bearer(aal: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'actor-1', aal })).toString('base64url')
  return `Bearer ${header}.${payload}.signature`
}

test('privileged management changes require a validated AAL2 or AAL3 session', () => {
  assert.equal(bearerAssuranceLevel(bearer('aal1')), 'aal1')
  assert.equal(hasPrivilegedAssurance(bearerAssuranceLevel(bearer('aal1'))), false)
  assert.equal(hasPrivilegedAssurance(bearerAssuranceLevel(bearer('aal2'))), true)
  assert.equal(hasPrivilegedAssurance(bearerAssuranceLevel(bearer('aal3'))), true)
  assert.equal(bearerAssuranceLevel('Bearer malformed'), 'unknown')
  assert.equal(hasPrivilegedAssurance('unknown'), false)
})
