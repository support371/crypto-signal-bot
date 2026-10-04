import assert from 'node:assert/strict'
import test from 'node:test'
import {DatabaseSync} from 'node:sqlite'
import {LiveDispatchAdmissionStore,type LiveDispatchClaim} from '../src/live/live-dispatch-admission-store.ts'

function fixture() {
  const db=new DatabaseSync(':memory:')
  let failDailyWrite=false
  const storage={sql:{exec(query:string,...args:(string|number)[]) {
    if(failDailyWrite && query.includes('INSERT INTO live_dispatch_daily_exposure')) throw Error('injected interrupted commit')
    if(!args.length && query.startsWith('CREATE ')) {db.exec(query);return {toArray:()=>[]}}
    const rows=db.prepare(query).all(...args)
    return {toArray:()=>rows}
  }},transactionSync<T>(fn:()=>T):T {db.exec('BEGIN');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}}}
  const identity={coordinatorName:'account-1',accountId:'account-1',accountRefHash:'a'.repeat(64),exchange:'BITGET' as const}
  const store=new LiveDispatchAdmissionStore(storage as any,identity)
  return {db,storage,identity,store,failWrite:()=>{failDailyWrite=true},recover:()=>{failDailyWrite=false}}
}
function claim(index=1):LiveDispatchClaim {
  return {attemptId:`attempt-${index}`,idempotencyKey:`key-${index}`,orderId:`order-${index}`,operation:'PLACE',
    candidateHash:'b'.repeat(64),releaseId:'release-1',releaseEvidenceHash:'c'.repeat(64),currentControlHash:'d'.repeat(64),
    claimedAt:'2026-10-04T10:00:00.000Z',notional:'100',maxOrderNotional:'100',maxDailyNotional:'1000'}
}
test('claim and exact daily exposure commit together without conferring execution',()=>{
  const f=fixture();try {
    const receipt=f.store.claim(claim())
    assert.equal(receipt.usedAndReservedNotional,'100');assert.equal(receipt.executionAllowed,false)
    assert.equal(receipt.automaticRetryAllowed,false)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,1)
  }finally{f.db.close()}
})
test('same attempt, idempotency key or logical order cannot reserve twice or dispatch after restart',()=>{
  const f=fixture();try {
    f.store.claim(claim());const restarted=new LiveDispatchAdmissionStore(f.storage as any,f.identity)
    for(const value of [claim(),{...claim(2),attemptId:'attempt-1'},{...claim(2),idempotencyKey:'key-1'},{...claim(2),orderId:'order-1'}]) {
      assert.throws(()=>restarted.claim(value),/ALREADY_CLAIMED/)
    }
    assert.equal(f.db.prepare('SELECT used_and_reserved_notional AS n FROM live_dispatch_daily_exposure').get()!.n,'100')
  }finally{f.db.close()}
})
test('simultaneous admission cannot exceed daily limit or count duplicates',async()=>{
  const f=fixture();try {
    const results=await Promise.allSettled(Array.from({length:20},(_,i)=>Promise.resolve().then(()=>f.store.claim(claim(i)))))
    assert.equal(results.filter(r=>r.status==='fulfilled').length,10)
    assert.equal(f.db.prepare('SELECT used_and_reserved_notional AS n FROM live_dispatch_daily_exposure').get()!.n,'1000')
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,10)
  }finally{f.db.close()}
})
test('failed budget write rolls back attempt and allows exactly one subsequent complete claim',()=>{
  const f=fixture();try {
    f.failWrite();assert.throws(()=>f.store.claim(claim()),/interrupted/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_budget_receipt').get()!.n,0)
    f.recover();f.store.claim(claim());assert.throws(()=>f.store.claim(claim()),/ALREADY_CLAIMED/)
  }finally{f.db.close()}
})
test('cancel adds no budget and new day does not erase a previously claimed place identity',()=>{
  const f=fixture();try {
    f.store.claim(claim())
    const cancel={...claim(2),orderId:'order-1',operation:'CANCEL' as const,notional:null}
    assert.equal(f.store.claim(cancel).usedAndReservedNotional,'100')
    assert.throws(()=>f.store.claim({...claim(),claimedAt:'2026-10-05T10:00:00.000Z'}),/ALREADY_CLAIMED/)
    assert.equal(f.store.claim({...claim(3),claimedAt:'2026-10-05T10:00:00.000Z'}).usedAndReservedNotional,'100')
  }finally{f.db.close()}
})
test('wrong namespace, provider or mutated persisted account owner cannot claim',()=>{
  const f=fixture();try {
    assert.throws(()=>new LiveDispatchAdmissionStore(f.storage as any,{...f.identity,coordinatorName:'other'}),/SCOPE_INVALID/)
    assert.throws(()=>new LiveDispatchAdmissionStore(f.storage as any,{...f.identity,exchange:'BTCC'}),/SCOPE_INVALID/)
    assert.throws(()=>f.db.exec("UPDATE live_dispatch_owner SET account_ref_hash='changed'"),/OWNER_IMMUTABLE/)
    assert.throws(()=>f.db.exec('DELETE FROM live_dispatch_owner'),/OWNER_IMMUTABLE/)
  }finally{f.db.close()}
})
test('durable exposure read retains interrupted attempts across restart and UTC rollover',()=>{
  const f=fixture();try {
    assert.equal(f.store.getDailyExposure(claim().claimedAt).usedAndReservedNotional,'0')
    f.store.claim({...claim(),notional:'0.100000000000000001'})
    f.store.claim({...claim(2),notional:'0.200000000000000002'})
    const restarted=new LiveDispatchAdmissionStore(f.storage as any,f.identity)
    assert.deepEqual(restarted.getDailyExposure(claim().claimedAt),{
      accountRefHash:f.identity.accountRefHash,exchange:'BITGET',utcDay:'2026-10-04',usedAndReservedNotional:'0.300000000000000003'})
    assert.equal(restarted.getDailyExposure('2026-10-05T00:00:00.000Z').usedAndReservedNotional,'0')
    assert.throws(()=>restarted.getDailyExposure('2026-10-04'),/CLOCK_INVALID/)
  }finally{f.db.close()}
})
test('editing or deleting an attempt or budget receipt cannot reopen dispatch',()=>{
  const f=fixture();try {
    f.store.claim(claim())
    for(const sql of ["UPDATE live_dispatch_admission SET attempt_id='changed'",
      'DELETE FROM live_dispatch_admission',"UPDATE live_dispatch_budget_receipt SET next_notional='0'",
      'DELETE FROM live_dispatch_budget_receipt']) assert.throws(()=>f.db.exec(sql),/IMMUTABLE/)
    assert.throws(()=>f.store.claim(claim()),/ALREADY_CLAIMED/)
    assert.equal(f.store.getDailyExposure(claim().claimedAt).usedAndReservedNotional,'100')
  }finally{f.db.close()}
})
test('lost or decreased daily cache fails before another attempt even after restart',()=>{
  for(const sql of ["UPDATE live_dispatch_daily_exposure SET used_and_reserved_notional='0'",
    'DELETE FROM live_dispatch_daily_exposure']) {
    const f=fixture();try {
      f.store.claim(claim()); f.db.exec(sql)
      const restarted=new LiveDispatchAdmissionStore(f.storage as any,f.identity)
      assert.throws(()=>restarted.getDailyExposure(claim().claimedAt),/BUDGET_INTEGRITY/)
      assert.throws(()=>restarted.claim(claim(2)),/BUDGET_INTEGRITY/)
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,1)
    }finally{f.db.close()}
  }
})
test('claims lacking budget receipts and orphan receipts fail closed',()=>{
  const f=fixture();try {
    assert.throws(()=>f.db.prepare('INSERT INTO live_dispatch_budget_receipt(attempt_id,utc_day,previous_notional,next_notional) VALUES(?,?,?,?)')
      .run('orphan','2026-10-04','0','100'),/LINK_INVALID/)
    const c=claim()
    f.db.prepare('INSERT INTO live_dispatch_admission VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(c.attemptId,c.idempotencyKey,c.orderId,c.operation,
      c.candidateHash,c.releaseId,c.releaseEvidenceHash,c.currentControlHash,c.claimedAt,'2026-10-04','100')
    assert.throws(()=>f.store.claim(claim(2)),/BUDGET_INTEGRITY/)
  }finally{f.db.close()}
})
test('SQL replacement cannot bypass immutable claims with recursive triggers disabled',()=>{
  const f=fixture();try {
    f.db.exec('PRAGMA recursive_triggers=OFF'); f.store.claim(claim())
    for(const table of ['live_dispatch_owner','live_dispatch_admission','live_dispatch_budget_receipt']) {
      assert.throws(()=>f.db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),/IMMUTABLE/)
    }
    assert.equal(f.store.getDailyExposure(claim().claimedAt).usedAndReservedNotional,'100')
  }finally{f.db.close()}
})
test('malformed financial evidence and microscopic overspending leave no attempt',()=>{
  const f=fixture();try {
    for(const value of [{notional:'100.000000000000000001'},{notional:'0'},{notional:'NaN'},{notional:100},
      {maxDailyNotional:'99'},{claimedAt:'2026-10-04T10:00:00Z'}]) {
      assert.throws(()=>f.store.claim({...claim(),...value} as LiveDispatchClaim))
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
  }finally{f.db.close()}
})
