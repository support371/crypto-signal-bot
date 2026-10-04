import { addDecimal, asDecimalString, compareDecimal } from './decimal.ts'

export interface LiveDispatchClaim {
  attemptId: string
  idempotencyKey: string
  orderId: string
  operation: 'PLACE' | 'CANCEL'
  candidateHash: string
  releaseId: string
  releaseEvidenceHash: string
  currentControlHash: string
  claimedAt: string
  /** Conservative fee-inclusive quote notional; null for cancellation. */
  notional: string | null
  maxOrderNotional: string
  maxDailyNotional: string
}

interface SqlStore {
  sql: {exec<T extends Record<string, SqlStorageValue>>(query: string, ...args: SqlStorageValue[]): {toArray(): T[]}}
  transactionSync<T>(closure: () => T): T
}

const identifier = /^[A-Za-z0-9:._-]{1,128}$/
const hash = /^[a-f0-9]{64}$/
const fail = (code: string): never => {throw new Error(code)}
function amount(value: unknown) {
  if (typeof value !== 'string' || value.length > 128 || !/^(0|[1-9]\d*)(\.\d{1,36})?$/.test(value)) {
    return fail('LIVE_DISPATCH_AMOUNT_INVALID')
  }
  return asDecimalString(value)
}

/**
 * Source-only persistence primitive for the existing named account coordinator.
 * It does not establish role/risk/provider/release authority or mint execution
 * capability. Call only after reloading those controls inside its serialized
 * account operation; never accept claim fields from a public request body.
 */
export class LiveDispatchAdmissionStore {
  readonly #storage: SqlStore
  readonly #accountId: string
  readonly #accountRefHash: string
  readonly #exchange: 'BITGET' | 'BTCC'

  constructor(storage: SqlStore, identity: {coordinatorName: string; accountId: string; accountRefHash: string; exchange: 'BITGET' | 'BTCC'}) {
    if (!identifier.test(identity.accountId) || identity.coordinatorName !== identity.accountId
      || !hash.test(identity.accountRefHash) || !['BITGET', 'BTCC'].includes(identity.exchange)) fail('LIVE_DISPATCH_ACCOUNT_SCOPE_INVALID')
    this.#storage = storage; this.#accountId = identity.accountId
    this.#accountRefHash = identity.accountRefHash; this.#exchange = identity.exchange
    storage.transactionSync(() => {
      storage.sql.exec(`CREATE TABLE IF NOT EXISTS live_dispatch_owner (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), account_id TEXT NOT NULL,
        account_ref_hash TEXT NOT NULL, exchange TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS live_dispatch_admission (
        attempt_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
        order_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('PLACE','CANCEL')),
        candidate_hash TEXT NOT NULL, release_id TEXT NOT NULL, release_evidence_hash TEXT NOT NULL,
        current_control_hash TEXT NOT NULL, claimed_at TEXT NOT NULL, utc_day TEXT NOT NULL,
        notional TEXT NOT NULL, UNIQUE(order_id,operation));
        CREATE TABLE IF NOT EXISTS live_dispatch_daily_exposure (
        utc_day TEXT PRIMARY KEY, used_and_reserved_notional TEXT NOT NULL);`)
      storage.sql.exec('INSERT OR IGNORE INTO live_dispatch_owner VALUES(1,?,?,?)', identity.accountId, identity.accountRefHash, identity.exchange)
      this.#assertOwner()
    })
  }

  #assertOwner() {
    const rows = this.#storage.sql.exec<{account_id: string; account_ref_hash: string; exchange: string}>('SELECT account_id,account_ref_hash,exchange FROM live_dispatch_owner WHERE singleton=1').toArray()
    if (rows.length !== 1 || rows[0].account_id !== this.#accountId
      || rows[0].account_ref_hash !== this.#accountRefHash || rows[0].exchange !== this.#exchange) fail('LIVE_DISPATCH_ACCOUNT_SCOPE_INVALID')
  }

  claim(input: Readonly<LiveDispatchClaim>) {
    for (const value of [input.attemptId,input.idempotencyKey,input.orderId,input.releaseId]) if (!identifier.test(value)) fail('LIVE_DISPATCH_IDENTITY_INVALID')
    for (const value of [input.candidateHash,input.releaseEvidenceHash,input.currentControlHash]) if (!hash.test(value)) fail('LIVE_DISPATCH_EVIDENCE_INVALID')
    if (!['PLACE','CANCEL'].includes(input.operation)) fail('LIVE_DISPATCH_OPERATION_INVALID')
    const now = Date.parse(input.claimedAt)
    if (!Number.isFinite(now) || new Date(now).toISOString() !== input.claimedAt) fail('LIVE_DISPATCH_CLOCK_INVALID')
    const zero = amount('0'), maxOrder = amount(input.maxOrderNotional), maxDaily = amount(input.maxDailyNotional)
    if (compareDecimal(maxOrder,zero) <= 0 || compareDecimal(maxDaily,maxOrder) < 0) fail('LIVE_DISPATCH_LIMIT_INVALID')
    const notional = input.operation === 'CANCEL' ? zero : amount(input.notional)
    if (input.operation === 'CANCEL' && input.notional !== null || input.operation === 'PLACE' && compareDecimal(notional,zero) <= 0) fail('LIVE_DISPATCH_AMOUNT_INVALID')
    if (compareDecimal(notional,maxOrder) > 0) fail('LIVE_DISPATCH_ORDER_LIMIT')
    const day = input.claimedAt.slice(0,10)
    return this.#storage.transactionSync(() => {
      this.#assertOwner()
      const existing = this.#storage.sql.exec(`SELECT attempt_id FROM live_dispatch_admission
        WHERE attempt_id=? OR idempotency_key=? OR (order_id=? AND operation=?) LIMIT 1`,
        input.attemptId,input.idempotencyKey,input.orderId,input.operation).toArray()
      // Even an interrupted or identical attempt cannot produce another dispatch capability.
      if (existing.length) fail('LIVE_DISPATCH_ATTEMPT_ALREADY_CLAIMED')
      const rows = this.#storage.sql.exec<{used_and_reserved_notional: string}>('SELECT used_and_reserved_notional FROM live_dispatch_daily_exposure WHERE utc_day=?',day).toArray()
      const previous = rows.length ? amount(rows[0].used_and_reserved_notional) : zero
      const next = addDecimal(previous,notional)
      if (input.operation === 'PLACE' && compareDecimal(next,maxDaily) > 0) fail('LIVE_DISPATCH_DAILY_LIMIT')
      this.#storage.sql.exec(`INSERT INTO live_dispatch_admission VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        input.attemptId,input.idempotencyKey,input.orderId,input.operation,input.candidateHash,input.releaseId,
        input.releaseEvidenceHash,input.currentControlHash,input.claimedAt,day,notional)
      this.#storage.sql.exec(`INSERT INTO live_dispatch_daily_exposure VALUES(?,?)
        ON CONFLICT(utc_day) DO UPDATE SET used_and_reserved_notional=excluded.used_and_reserved_notional`,day,next)
      return Object.freeze({attemptId:input.attemptId,accountId:this.#accountId,accountRefHash:this.#accountRefHash,
        exchange:this.#exchange,candidateHash:input.candidateHash,claimedAt:input.claimedAt,utcDay:day,
        usedAndReservedNotional:next,executionAllowed:false as const,automaticRetryAllowed:false as const})
    })
  }
}
