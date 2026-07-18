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
    return sequence >= 3 && sequence <= 24
  })
  .sort()

if (migrations[0] !== '003_live_release_authorizations.sql') {
  throw new Error('live-candidate migration sequence must start at 003')
}
if (migrations.at(-1) !== '024_live_bitget_attested_recovery_readiness.sql') {
  throw new Error('live-candidate migration sequence must end at 024')
}
if (!migrations.includes('020_live_recovery_accounting_dispatch_attempts.sql')) {
  throw new Error('migration 020 dispatch-attempt boundary is missing')
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

const emptyDatabase = database()
try {
  apply(emptyDatabase, migrations, 'empty database migration sequence')
} finally {
  emptyDatabase.close()
}

const upgradeDatabase = database()
try {
  apply(upgradeDatabase, baselineMigrations, 'upgrade baseline through migration 019')
  apply(upgradeDatabase, upgradeMigrations, 'upgrade from migration 019 through migration 024')
  apply(upgradeDatabase, upgradeMigrations, 'idempotent replay of migrations 020 through 024')
} finally {
  upgradeDatabase.close()
}

console.log(
  `Live-candidate empty and upgrade paths verified (${migrations.length} files; migrations 020-024 replayed).`,
)
