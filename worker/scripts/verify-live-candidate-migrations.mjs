import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsRoot = path.resolve(here, '..', 'migrations')

const migrations = fs.readdirSync(migrationsRoot)
  .filter((name) => {
    const match = /^(\d{3})_.*\.sql$/.exec(name)
    if (!match) return false
    const sequence = Number(match[1])
    return sequence >= 3 && sequence <= 28
  })
  .sort()

if (migrations[0] !== '003_live_release_authorizations.sql') {
  throw new Error('live-candidate migration sequence must start at 003')
}
if (migrations.at(-1) !== '028_live_bitget_demo_deployment_readiness.sql') {
  throw new Error('live-candidate migration sequence must end at 028')
}
for (const required of [
  '020_live_recovery_accounting_dispatch_attempts.sql',
  '025_live_bitget_demo_dispatch_evidence.sql',
  '026_live_bitget_demo_certification_evidence.sql',
  '027_live_bitget_demo_control_bindings.sql',
  '028_live_bitget_demo_deployment_readiness.sql',
]) {
  if (!migrations.includes(required)) throw new Error(`required live migration is missing: ${required}`)
}

const upgradeMigrations = migrations.filter((name) => Number(name.slice(0, 3)) >= 20)
const baselineMigrations = migrations.filter((name) => Number(name.slice(0, 3)) <= 19)

function migrationSql(name) {
  return fs.readFileSync(path.join(migrationsRoot, name), 'utf8')
}

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}

function apply(db, selectedMigrations, pass) {
  for (const migration of selectedMigrations) {
    try {
      db.exec(migrationSql(migration))
    } catch (error) {
      throw new Error(`${pass} failed at ${migration}`, { cause: error })
    }
  }
}

function expectRejected(db, sql, label) {
  try {
    db.exec(sql)
  } catch {
    return
  }
  throw new Error(`${label} was not rejected`)
}

function verifyBitgetDemoEvidenceConstraints(db) {
  const hash = (character) => character.repeat(64)
  db.exec(`
    INSERT INTO live_step_up_sessions (
      step_up_session_id, actor_id, authentication_method, assurance_level,
      audience, issued_at, expires_at, session_hash
    ) VALUES (
      'migration-025-step-up', 'migration-025-reviewer', 'fixture', 'AAL2',
      'BITGET_DEMO_DISPATCH', '2026-07-18T03:00:00.000Z',
      '2026-07-18T03:05:00.000Z', '${hash('a')}'
    );
    INSERT INTO live_authorization_events (
      authorization_event_id, actor_id, action, resource_type, resource_id,
      required_roles_json, actor_roles_json, step_up_required,
      step_up_session_id, decision, correlation_id, audit_event_hash,
      occurred_at
    ) VALUES (
      'migration-025-authorization', 'migration-025-reviewer',
      'BITGET_DEMO_DISPATCH', 'BITGET_DEMO_CANDIDATE', '${hash('b')}',
      '["RISK_OPERATOR"]', '["RISK_OPERATOR"]', 1,
      'migration-025-step-up', 'ALLOW', 'migration-025-correlation',
      '${hash('c')}', '2026-07-18T03:00:01.000Z'
    );
    INSERT INTO live_bitget_demo_dispatch_authorizations (
      authorization_id, dispatch_attempt_id, exchange_account_id,
      candidate_hash, operation, endpoint, product_symbol, actor_id,
      preparer_id, authorization_evidence_hash, step_up_evidence_hash,
      risk_evidence_hash, guardian_evidence_hash, idempotency_evidence_hash,
      valid_from, expires_at, validity_seconds, authorization_hash, reviewed_at
    ) VALUES (
      'migration-025-authorization', 'migration-025-attempt',
      'migration-025-account', '${hash('b')}', 'PLACE',
      '/api/v2/spot/trade/place-order', 'BTCUSDT',
      'migration-025-reviewer', 'migration-025-preparer', '${hash('c')}',
      '${hash('a')}', '${hash('d')}', '${hash('e')}', '${hash('f')}',
      '2026-07-18T03:00:02.000Z', '2026-07-18T03:01:02.000Z', 60,
      '${hash('1')}', '2026-07-18T03:00:01.500Z'
    );
    INSERT INTO live_bitget_demo_dispatch_claims (
      dispatch_attempt_id, authorization_id, exchange_account_id,
      candidate_hash, authorization_hash, claim_hash, claimed_at
    ) VALUES (
      'migration-025-attempt', 'migration-025-authorization',
      'migration-025-account', '${hash('b')}', '${hash('1')}',
      '${hash('2')}', '2026-07-18T03:00:30.000Z'
    );
    INSERT INTO live_bitget_demo_control_verifications (
      dispatch_attempt_id, authorization_id, exchange_account_id,
      candidate_hash, operation, product_symbol, claim_hash,
      guardian_evidence_hash, risk_evidence_hash,
      idempotency_evidence_hash, verified_at, verification_hash
    ) VALUES (
      'migration-025-attempt', 'migration-025-authorization',
      'migration-025-account', '${hash('b')}', 'PLACE', 'BTCUSDT',
      '${hash('2')}', '${hash('e')}', '${hash('d')}', '${hash('f')}',
      '2026-07-18T03:00:30.500Z', '${hash('9')}'
    );
    INSERT INTO live_bitget_demo_dispatch_results (
      dispatch_attempt_id, authorization_id, exchange_account_id,
      candidate_hash, operation, endpoint, category, reason,
      request_body_hash, recovery_lookup_count, result_json, result_hash,
      demo_request_sent, demo_provider_mutation_attempted,
      requires_read_only_recovery, provider_acknowledgment_verified,
      occurred_at
    ) VALUES (
      'migration-025-attempt', 'migration-025-authorization',
      'migration-025-account', '${hash('b')}', 'PLACE',
      '/api/v2/spot/trade/place-order', 'PRE_SEND_BLOCKED',
      'migration_verifier_pre_send_block', '${hash('3')}', 0, '{}',
      '${hash('4')}', 0, 0, 0, 0, '2026-07-18T03:00:31.000Z'
    );

    INSERT INTO live_candidate_assessments (
      assessment_id, internal_order_id, exchange_account_id, provider,
      idempotency_key, request_hash, preview_hash, evidence_hash, status,
      operational_checks_passed, execution_allowed, preview_json,
      risk_decision_json, reasons_json, coordinator_id,
      coordinator_sequence, committed_at
    ) VALUES (
      'migration-027-assessment', 'migration-027-order',
      'migration-025-account', 'BITGET', 'migration-027-idempotency-key',
      '${hash('5')}', '${hash('6')}', '${hash('7')}',
      'READY_BUT_EXECUTION_LOCKED', 1, 0, '{}',
      '{"decisionId":"migration-027-risk","approved":true,"rules":[],"configurationVersion":"v1","decidedAt":"2026-07-18T03:00:29.000Z"}',
      '[]', 'migration-027-coordinator', 1, '2026-07-18T03:00:29.000Z'
    );
    INSERT INTO idempotency_records (
      operation_scope, idempotency_key, request_hash, operation_id,
      exchange_account_id, actor_id, status, expires_at
    ) VALUES (
      'BITGET_DEMO_PLACE', 'migration-027-idempotency-key', '${hash('8')}',
      'migration-027-operation', 'migration-025-account',
      'migration-025-reviewer', 'CLAIMED', '2026-07-18T03:02:00.000Z'
    );
    INSERT INTO live_bitget_demo_place_control_bindings (
      binding_id, authorization_id, dispatch_attempt_id,
      exchange_account_id, candidate_hash, operation, product_symbol,
      assessment_id, assessment_evidence_hash, preview_hash,
      risk_decision_id, risk_configuration_version, risk_decision_hash,
      guardian_scopes_json, guardian_scope_count, guardian_scope_set_hash,
      guardian_reviewed_state_hash, idempotency_operation_id,
      idempotency_operation_scope, idempotency_key_hash,
      control_binding_hash, bound_at
    ) VALUES (
      'migration-027-binding', 'migration-025-authorization',
      'migration-025-attempt', 'migration-025-account', '${hash('b')}',
      'PLACE', 'BTCUSDT', 'migration-027-assessment', '${hash('7')}',
      '${hash('6')}', 'migration-027-risk', 'v1', '${hash('9')}',
      '[{"scopeType":"GLOBAL","scopeKey":"global"}]', 1,
      '${hash('0')}', '${hash('a')}', 'migration-027-operation',
      'BITGET_DEMO_PLACE', '${hash('b')}', '${hash('c')}',
      '2026-07-18T03:00:30.000Z'
    );

    INSERT INTO live_bitget_demo_deployment_readiness_manifests (
      manifest_id, git_sha, evidence_hashes_json, checks_json,
      check_count, passed_count, blockers_json, status,
      ready_for_non_live_deployment_review, manifest_hash,
      prepared_by, prepared_at
    ) VALUES (
      'migration-028-blocked', '${'d'.repeat(40)}', '{}',
      '[1,2,3,4,5,6,7,8,9,10,11,12,13,14]', 14, 1,
      '["external evidence missing"]', 'BLOCKED', 0, '${hash('e')}',
      'migration-028-preparer', '2026-07-18T03:00:32.000Z'
    );
  `)

  for (const [sql, label] of [
    ["UPDATE live_bitget_demo_dispatch_authorizations SET mainnet_allowed = 1 WHERE authorization_id = 'migration-025-authorization';", 'immutable Bitget demo authorization update'],
    ["UPDATE live_bitget_demo_dispatch_claims SET automatically_retried = 1 WHERE dispatch_attempt_id = 'migration-025-attempt';", 'immutable Bitget demo claim update'],
    ["DELETE FROM live_bitget_demo_dispatch_results WHERE dispatch_attempt_id = 'migration-025-attempt';", 'immutable Bitget demo result deletion'],
    ["UPDATE live_bitget_demo_control_verifications SET automatically_retried = 1 WHERE dispatch_attempt_id = 'migration-025-attempt';", 'immutable Bitget demo fresh-control verification update'],
    ["UPDATE live_bitget_demo_place_control_bindings SET execution_allowed = 1 WHERE binding_id = 'migration-027-binding';", 'immutable Bitget demo control-binding update'],
    ["DELETE FROM live_bitget_demo_place_control_bindings WHERE binding_id = 'migration-027-binding';", 'immutable Bitget demo control-binding deletion'],
    ["UPDATE live_bitget_demo_deployment_readiness_manifests SET deployment_allowed = 1 WHERE manifest_id = 'migration-028-blocked';", 'immutable Bitget demo readiness update'],
    ["DELETE FROM live_bitget_demo_deployment_readiness_manifests WHERE manifest_id = 'migration-028-blocked';", 'immutable Bitget demo readiness deletion'],
  ]) {
    expectRejected(db, sql, label)
  }
}

const emptyDatabase = database()
try {
  apply(emptyDatabase, migrations, 'empty database migration sequence')
  verifyBitgetDemoEvidenceConstraints(emptyDatabase)
} finally {
  emptyDatabase.close()
}

const upgradeDatabase = database()
try {
  apply(upgradeDatabase, baselineMigrations, 'upgrade baseline through migration 019')
  apply(upgradeDatabase, upgradeMigrations, 'upgrade from migration 019 through migration 028')
  apply(upgradeDatabase, upgradeMigrations, 'idempotent replay of migrations 020 through 028')
} finally {
  upgradeDatabase.close()
}

console.log(
  `Live-candidate empty and upgrade paths verified (${migrations.length} files; migrations 020-028 replayed).`,
)
