import { addDecimal, asDecimalString, compareDecimal } from './decimal.ts'
import { canonicalHash } from './canonical-json.ts'
import { evaluateLiveOperationRelease, type LiveOperationReleaseInput, type OperationReleaseEvidence } from './live-operation-release-policy.ts'

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

export type ReleaseScopedDispatchClaim = Omit<LiveDispatchClaim,
  'releaseId' | 'releaseEvidenceHash' | 'claimedAt' | 'maxOrderNotional' | 'maxDailyNotional'> & {productId: string}

/** Server dependencies: reload persisted release/runtime inside the account's serialized operation. */
export interface DispatchReleaseLoader {
  loadRelease(): Promise<{release: Readonly<OperationReleaseEvidence> | null; runtime: LiveOperationReleaseInput['runtime']}>
  clock(): Date
}

interface SqlStore {
  sql: {exec<T extends Record<string, SqlStorageValue>>(query: string, ...args: SqlStorageValue[]): {toArray(): T[]}}
  transactionSync<T>(closure: () => T): T
}

const identifier = /^[A-Za-z0-9:._-]{1,128}$/
const hash = /^[a-f0-9]{64}$/
const fail = (code: string): never => {throw new Error(code)}
function utcDay(value: unknown) {
  if (typeof value !== 'string') return fail('LIVE_DISPATCH_CLOCK_INVALID')
  const time = Date.parse(value)
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) fail('LIVE_DISPATCH_CLOCK_INVALID')
  return value.slice(0,10)
}
function amount(value: unknown) {
  if (typeof value !== 'string' || value.length > 128 || !/^(0|[1-9]\d*)(\.\d{1,36})?$/.test(value)) {
    return fail('LIVE_DISPATCH_AMOUNT_INVALID')
  }
  return asDecimalString(value)
}
function clockTime(clock: () => Date) {
  const value = clock()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return fail('LIVE_DISPATCH_CLOCK_INVALID')
  return value.getTime()
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
    if (typeof identity.accountId !== 'string' || !identifier.test(identity.accountId) || identity.coordinatorName !== identity.accountId
      || typeof identity.accountRefHash !== 'string' || !hash.test(identity.accountRefHash) || !['BITGET', 'BTCC'].includes(identity.exchange)) fail('LIVE_DISPATCH_ACCOUNT_SCOPE_INVALID')
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
        utc_day TEXT PRIMARY KEY, used_and_reserved_notional TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS live_dispatch_budget_receipt (
        sequence_id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE,
        utc_day TEXT NOT NULL, previous_notional TEXT NOT NULL, next_notional TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS live_dispatch_budget_day ON live_dispatch_budget_receipt(utc_day,sequence_id);
        CREATE INDEX IF NOT EXISTS live_dispatch_admission_day ON live_dispatch_admission(utc_day);`)
      if (!storage.sql.exec('SELECT singleton FROM live_dispatch_owner WHERE singleton=1').toArray().length) {
        storage.sql.exec('INSERT INTO live_dispatch_owner VALUES(1,?,?,?)', identity.accountId, identity.accountRefHash, identity.exchange)
      }
      this.#assertOwner()
      storage.sql.exec(`CREATE TRIGGER IF NOT EXISTS live_dispatch_owner_no_replace BEFORE INSERT ON live_dispatch_owner
        WHEN EXISTS(SELECT 1 FROM live_dispatch_owner WHERE singleton=NEW.singleton)
        BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_OWNER_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_owner_no_update BEFORE UPDATE ON live_dispatch_owner BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_OWNER_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_owner_no_delete BEFORE DELETE ON live_dispatch_owner BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_OWNER_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_admission_no_update BEFORE UPDATE ON live_dispatch_admission BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_ATTEMPT_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_admission_no_delete BEFORE DELETE ON live_dispatch_admission BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_ATTEMPT_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_admission_no_replace BEFORE INSERT ON live_dispatch_admission
        WHEN EXISTS(SELECT 1 FROM live_dispatch_admission WHERE attempt_id=NEW.attempt_id OR idempotency_key=NEW.idempotency_key OR (order_id=NEW.order_id AND operation=NEW.operation))
        BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_ATTEMPT_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_budget_no_update BEFORE UPDATE ON live_dispatch_budget_receipt BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_BUDGET_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_budget_no_delete BEFORE DELETE ON live_dispatch_budget_receipt BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_BUDGET_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_budget_no_replace BEFORE INSERT ON live_dispatch_budget_receipt
        WHEN EXISTS(SELECT 1 FROM live_dispatch_budget_receipt WHERE attempt_id=NEW.attempt_id OR sequence_id=NEW.sequence_id)
        BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_BUDGET_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS live_dispatch_budget_link BEFORE INSERT ON live_dispatch_budget_receipt
        WHEN NOT EXISTS(SELECT 1 FROM live_dispatch_admission WHERE attempt_id=NEW.attempt_id AND utc_day=NEW.utc_day)
        BEGIN SELECT RAISE(ABORT,'LIVE_DISPATCH_BUDGET_LINK_INVALID'); END;`)
    })
  }

  #dailyExposure(day: string) {
    const rows = this.#storage.sql.exec<{used_and_reserved_notional: string}>('SELECT used_and_reserved_notional FROM live_dispatch_daily_exposure WHERE utc_day=?',day).toArray()
    const counts = this.#storage.sql.exec<{claims: number; receipts: number}>(`SELECT
      (SELECT COUNT(*) FROM live_dispatch_admission WHERE utc_day=?) AS claims,
      (SELECT COUNT(*) FROM live_dispatch_budget_receipt WHERE utc_day=?) AS receipts`,day,day).toArray()[0]
    const last = this.#storage.sql.exec<{previous_notional: string; next_notional: string; notional: string}>(`SELECT r.previous_notional,r.next_notional,a.notional
      FROM live_dispatch_budget_receipt r JOIN live_dispatch_admission a ON a.attempt_id=r.attempt_id AND a.utc_day=r.utc_day
      WHERE r.utc_day=? ORDER BY r.sequence_id DESC LIMIT 1`,day).toArray()
    // A lost/edited cache or legacy claims without receipts must never reset the allowance.
    if (!counts || counts.claims !== counts.receipts || rows.length > 1
      || (counts.claims > 0 && (last.length !== 1 || rows.length !== 1))
      || (counts.claims === 0 && (last.length !== 0 || rows.length !== 0))) fail('LIVE_DISPATCH_BUDGET_INTEGRITY_INVALID')
    if (!counts.claims) return amount('0')
    const used = amount(rows[0].used_and_reserved_notional)
    const receipt = last[0]
    if (compareDecimal(used,amount(receipt.next_notional)) !== 0
      || compareDecimal(addDecimal(amount(receipt.previous_notional),amount(receipt.notional)),used) !== 0) fail('LIVE_DISPATCH_BUDGET_INTEGRITY_INVALID')
    return used
  }

  /** Trusted policy input from this account's durable state; never a supplied budget. */
  getDailyExposure(evaluatedAt: string) {
    const day = utcDay(evaluatedAt)
    return this.#storage.transactionSync(() => {
      this.#assertOwner()
      return Object.freeze({accountRefHash:this.#accountRefHash,exchange:this.#exchange,
        utcDay:day,usedAndReservedNotional:this.#dailyExposure(day)})
    })
  }

  #assertOwner() {
    const rows = this.#storage.sql.exec<{account_id: string; account_ref_hash: string; exchange: string}>('SELECT account_id,account_ref_hash,exchange FROM live_dispatch_owner WHERE singleton=1').toArray()
    if (rows.length !== 1 || rows[0].account_id !== this.#accountId
      || rows[0].account_ref_hash !== this.#accountRefHash || rows[0].exchange !== this.#exchange) fail('LIVE_DISPATCH_ACCOUNT_SCOPE_INVALID')
  }

  /**
   * Join a fresh persisted release to atomic admission. No caller-provided
   * allowance, limit, timestamp or release hash is accepted. This remains a
   * prerequisite, not execution authority; current role/risk/reservation/
   * Guardian/provider checks must surround it in the serialized coordinator.
   */
  async claimWithRelease(input: Readonly<ReleaseScopedDispatchClaim>, dependencies: DispatchReleaseLoader) {
    const keys = ['attemptId','idempotencyKey','orderId','operation','candidateHash','currentControlHash','notional','productId']
    if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input,key))) fail('LIVE_DISPATCH_SCOPED_INPUT_INVALID')
    input = Object.freeze({attemptId:input.attemptId,idempotencyKey:input.idempotencyKey,orderId:input.orderId,
      operation:input.operation,candidateHash:input.candidateHash,currentControlHash:input.currentControlHash,
      notional:input.notional,productId:input.productId})
    for (const value of [input.attemptId,input.idempotencyKey,input.orderId]) if (typeof value !== 'string' || !identifier.test(value)) fail('LIVE_DISPATCH_IDENTITY_INVALID')
    for (const value of [input.candidateHash,input.currentControlHash]) if (typeof value !== 'string' || !hash.test(value)) fail('LIVE_DISPATCH_EVIDENCE_INVALID')
    if (typeof input.productId !== 'string' || input.productId.length > 42 || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(input.productId)) fail('LIVE_DISPATCH_PRODUCT_INVALID')
    if (!['PLACE','CANCEL'].includes(input.operation)) fail('LIVE_DISPATCH_OPERATION_INVALID')
    if (input.operation === 'CANCEL' ? input.notional !== null : compareDecimal(amount(input.notional),amount('0')) <= 0) fail('LIVE_DISPATCH_AMOUNT_INVALID')
    if (typeof dependencies?.loadRelease !== 'function' || typeof dependencies?.clock !== 'function') fail('LIVE_DISPATCH_RELEASE_LOADER_REQUIRED')
    const clock = dependencies.clock.bind(dependencies), loader = dependencies.loadRelease.bind(dependencies)
    const started = clockTime(clock)
    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    const deadline = new Promise<never>((_,reject) => {timer = setTimeout(() => {
      timedOut = true; reject(new Error('LIVE_DISPATCH_RELEASE_RELOAD_TIMEOUT'))
    },2_000)})
    try {
      return await Promise.race([deadline,(async () => {
        let loaded: Awaited<ReturnType<DispatchReleaseLoader['loadRelease']>>
        try {loaded = await loader()} catch {return fail('LIVE_DISPATCH_RELEASE_UNAVAILABLE')}
        const r = loaded?.release, v = loaded?.runtime
        if (!r || !v) return fail('LIVE_DISPATCH_RELEASE_UNAVAILABLE')
        if (!Array.isArray(r.allowedProducts) || r.allowedProducts.length > 100
          || r.allowedProducts.some(p => typeof p !== 'string' || p.length > 42 || !/^[A-Z0-9]+-[A-Z0-9]+$/.test(p))) fail('LIVE_DISPATCH_RELEASE_INVALID')
        const release = Object.freeze({releaseId:r.releaseId,gitSha:r.gitSha,workerDeploymentId:r.workerDeploymentId,
          frontendDeploymentId:r.frontendDeploymentId,schemaVersion:r.schemaVersion,exchange:r.exchange,
          accountRefHash:r.accountRefHash,allowedProducts:Object.freeze([...r.allowedProducts]),
          maxOrderNotional:r.maxOrderNotional,maxDailyNotional:r.maxDailyNotional,startsAt:r.startsAt,
          expiresAt:r.expiresAt,status:r.status,securityReviewRef:r.securityReviewRef,complianceReviewRef:r.complianceReviewRef})
        const runtime = Object.freeze({artifact:v.artifact,network:v.network,releaseId:v.releaseId,gitSha:v.gitSha,
          workerDeploymentId:v.workerDeploymentId,frontendDeploymentId:v.frontendDeploymentId,schemaVersion:v.schemaVersion,
          withdrawalsEnabled:v.withdrawalsEnabled})
        // Bound all persisted scalar fields before hashing or coercion in policy.
        if (Object.entries(release).some(([key,value]) => key !== 'allowedProducts' && (typeof value !== 'string' || value.length > 256))
          || Object.entries(runtime).some(([key,value]) => key !== 'withdrawalsEnabled' && (typeof value !== 'string' || value.length > 256))) fail('LIVE_DISPATCH_RELEASE_INVALID')
        const maxOrder = amount(release.maxOrderNotional), maxDaily = amount(release.maxDailyNotional)
        const releaseEvidenceHash = await canonicalHash(release)
        // A timed-out loader/hash may resolve later; it cannot leave a late claim.
        const evaluated = clockTime(clock)
        if (timedOut || evaluated < started || evaluated - started >= 2_000) fail('LIVE_DISPATCH_RELEASE_RELOAD_TIMEOUT')
        const evaluatedAt = new Date(evaluated).toISOString(), day = utcDay(evaluatedAt)
        const claim: LiveDispatchClaim = {...input,releaseId:release.releaseId,releaseEvidenceHash,claimedAt:evaluatedAt,
          maxOrderNotional:maxOrder,maxDailyNotional:maxDaily}
        const prepared = this.#prepare(claim)
        return this.#storage.transactionSync(() => this.#commit(claim,prepared,(previous) => {
          const committed = clockTime(clock), committedAt = new Date(committed).toISOString()
          if (timedOut || committed < evaluated || committed - started >= 2_000 || utcDay(committedAt) !== day) fail('LIVE_DISPATCH_RELEASE_RELOAD_TIMEOUT')
          const report = evaluateLiveOperationRelease({release,runtime,operation:input.operation,
            exchange:this.#exchange,accountRefHash:this.#accountRefHash,productId:input.productId,
            evaluatedAt:committedAt,orderNotional:input.notional,dailyExposure:{accountRefHash:this.#accountRefHash,
              exchange:this.#exchange,utcDay:day,usedAndReservedNotional:previous}})
          if (!report.releaseScopeSatisfied) fail('LIVE_DISPATCH_RELEASE_SCOPE_DENIED')
          return committedAt
        }))
      })()])
    } finally {if (timer !== undefined) clearTimeout(timer)}
  }

  #prepare(input: Readonly<LiveDispatchClaim>) {
    for (const value of [input.attemptId,input.idempotencyKey,input.orderId,input.releaseId]) if (typeof value !== 'string' || !identifier.test(value)) fail('LIVE_DISPATCH_IDENTITY_INVALID')
    for (const value of [input.candidateHash,input.releaseEvidenceHash,input.currentControlHash]) if (typeof value !== 'string' || !hash.test(value)) fail('LIVE_DISPATCH_EVIDENCE_INVALID')
    if (!['PLACE','CANCEL'].includes(input.operation)) fail('LIVE_DISPATCH_OPERATION_INVALID')
    const day = utcDay(input.claimedAt)
    const zero = amount('0'), maxOrder = amount(input.maxOrderNotional), maxDaily = amount(input.maxDailyNotional)
    if (compareDecimal(maxOrder,zero) <= 0 || compareDecimal(maxDaily,maxOrder) < 0) fail('LIVE_DISPATCH_LIMIT_INVALID')
    const notional = input.operation === 'CANCEL' ? zero : amount(input.notional)
    if (input.operation === 'CANCEL' && input.notional !== null || input.operation === 'PLACE' && compareDecimal(notional,zero) <= 0) fail('LIVE_DISPATCH_AMOUNT_INVALID')
    if (compareDecimal(notional,maxOrder) > 0) fail('LIVE_DISPATCH_ORDER_LIMIT')
    return {day,notional,maxDaily}
  }

  /** Low-level compatibility primitive; future executable composition must use claimWithRelease. */
  claim(input: Readonly<LiveDispatchClaim>) {
    const prepared = this.#prepare(input)
    return this.#storage.transactionSync(() => this.#commit(input,prepared))
  }

  #commit(input: Readonly<LiveDispatchClaim>, {day,notional,maxDaily}: {day:string;notional:ReturnType<typeof amount>;maxDaily:ReturnType<typeof amount>},
    validateRelease?: (previous: ReturnType<typeof amount>) => string) {
      this.#assertOwner()
      const existing = this.#storage.sql.exec(`SELECT attempt_id FROM live_dispatch_admission
        WHERE attempt_id=? OR idempotency_key=? OR (order_id=? AND operation=?) LIMIT 1`,
        input.attemptId,input.idempotencyKey,input.orderId,input.operation).toArray()
      // Even an interrupted or identical attempt cannot produce another dispatch capability.
      if (existing.length) fail('LIVE_DISPATCH_ATTEMPT_ALREADY_CLAIMED')
      const previous = this.#dailyExposure(day)
      if (validateRelease) input = {...input,claimedAt:validateRelease(previous)}
      const next = addDecimal(previous,notional)
      if (input.operation === 'PLACE' && compareDecimal(next,maxDaily) > 0) fail('LIVE_DISPATCH_DAILY_LIMIT')
      this.#storage.sql.exec(`INSERT INTO live_dispatch_admission VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        input.attemptId,input.idempotencyKey,input.orderId,input.operation,input.candidateHash,input.releaseId,
        input.releaseEvidenceHash,input.currentControlHash,input.claimedAt,day,notional)
      this.#storage.sql.exec('INSERT INTO live_dispatch_budget_receipt(attempt_id,utc_day,previous_notional,next_notional) VALUES(?,?,?,?)',input.attemptId,day,previous,next)
      this.#storage.sql.exec(`INSERT INTO live_dispatch_daily_exposure VALUES(?,?)
        ON CONFLICT(utc_day) DO UPDATE SET used_and_reserved_notional=excluded.used_and_reserved_notional`,day,next)
      return Object.freeze({attemptId:input.attemptId,accountId:this.#accountId,accountRefHash:this.#accountRefHash,
        exchange:this.#exchange,candidateHash:input.candidateHash,claimedAt:input.claimedAt,utcDay:day,
        usedAndReservedNotional:next,executionAllowed:false as const,automaticRetryAllowed:false as const})
  }
}
