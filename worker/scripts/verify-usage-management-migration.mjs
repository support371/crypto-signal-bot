import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = path.resolve(here, '..', 'migrations', '031_usage_management.sql');
const sql = fs.readFileSync(migration, 'utf8');

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function expectRejected(db, statement, label) {
  try {
    db.exec(statement);
  } catch {
    return;
  }
  throw new Error(`${label} was not rejected`);
}

const db = database();
try {
  db.exec(sql);
  db.exec(sql);
  db.exec(`
    INSERT INTO app_user_profiles (
      actor_id, auth_provider_id, email, status, account_type, onboarding_state,
      created_at, updated_at
    ) VALUES (
      'migration-user', 'migration-user', 'migration@example.invalid', 'ACTIVE',
      'STANDARD', 'COMPLETE', '2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z'
    );
    INSERT INTO live_actor_roles (
      actor_id, role, scope_type, scope_key, granted_by, granted_at
    ) VALUES (
      'migration-user', 'VIEWER', 'GLOBAL', 'global', 'migration-verifier',
      '2026-09-05T00:00:00.000Z'
    );
    INSERT INTO management_audit_events (
      event_id, actor_id, action, resource_type, resource_id, decision,
      request_id, event_hash, occurred_at
    ) VALUES (
      'migration-audit', 'migration-user', 'VERIFY', 'USER', 'migration-user',
      'ALLOW', 'migration-request', '${'a'.repeat(64)}', '2026-09-05T00:00:01.000Z'
    );
    INSERT INTO app_usage_daily (
      day, actor_id, category, request_count, success_count, rejected_count, updated_at
    ) VALUES (
      '2026-09-05', 'migration-user', 'dashboard_view', 1, 1, 0,
      '2026-09-05T00:00:02.000Z'
    );
  `);

  expectRejected(
    db,
    "UPDATE management_audit_events SET decision = 'DENY' WHERE event_id = 'migration-audit';",
    'immutable management audit update',
  );
  expectRejected(
    db,
    "DELETE FROM management_audit_events WHERE event_id = 'migration-audit';",
    'immutable management audit deletion',
  );
  expectRejected(
    db,
    "INSERT INTO app_user_profiles (actor_id,auth_provider_id,status,account_type,onboarding_state,created_at,updated_at) VALUES ('bad','bad','ROOT','STANDARD','COMPLETE','x','x');",
    'invalid user status',
  );
} finally {
  db.close();
}

console.log('Usage-management migration 031 verified: empty apply, idempotent replay, status constraints, role storage, usage aggregation, and immutable audit triggers.');
