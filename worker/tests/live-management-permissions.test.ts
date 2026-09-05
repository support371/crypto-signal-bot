import assert from 'node:assert/strict'
import test from 'node:test'
import { permissionsForRoles, type ManagementRole } from '../src/management.ts'

function roles(...values: ManagementRole[]) {
  return values.map((role) => ({ role }))
}

test('viewer has no administrative management authority', () => {
  const permissions = permissionsForRoles(roles('VIEWER'))
  assert.equal(permissions.canReadAdmin, false)
  assert.equal(permissions.canManageUsers, false)
  assert.equal(permissions.canManageAccess, false)
})

test('auditor can inspect audit and usage but cannot mutate users', () => {
  const permissions = permissionsForRoles(roles('AUDITOR'))
  assert.equal(permissions.canReadAdmin, true)
  assert.equal(permissions.canViewAudit, true)
  assert.equal(permissions.canViewUsage, true)
  assert.equal(permissions.canManageUsers, false)
})

test('risk admin can inspect and manage system but cannot grant roles', () => {
  const permissions = permissionsForRoles(roles('RISK_ADMIN'))
  assert.equal(permissions.canReadAdmin, true)
  assert.equal(permissions.canManageSystem, true)
  assert.equal(permissions.canManageAccess, false)
})

test('release admin is the sole management role with user and access mutation authority', () => {
  const permissions = permissionsForRoles(roles('RELEASE_ADMIN'))
  assert.equal(permissions.canReadAdmin, true)
  assert.equal(permissions.canManageUsers, true)
  assert.equal(permissions.canManageAccess, true)
  assert.equal(permissions.canViewAudit, true)
  assert.equal(permissions.canViewUsage, true)
})
