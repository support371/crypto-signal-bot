import assert from 'node:assert/strict'
import test from 'node:test'
import {DatabaseSync} from 'node:sqlite'
import {LiveDispatchAdmissionStore,type LiveDispatchClaim,type ReleaseScopedDispatchClaim} from '../src/live/live-dispatch-admission-store.ts'
import {canonicalHash} from '../src/live/canonical-json.ts'
import type {LiveOperationReleaseInput} from '../src/live/live-operation-release-policy.ts'

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
function scopedClaim(index=1):ReleaseScopedDispatchClaim {
  const c=claim(index)
  return {attemptId:c.attemptId,idempotencyKey:c.idempotencyKey,orderId:c.orderId,operation:c.operation,
    candidateHash:c.candidateHash,currentControlHash:c.currentControlHash,notional:c.notional,productId:'BTC-USDT'}
}
function releaseLoader() {
  const runtime:LiveOperationReleaseInput['runtime']={artifact:'live-execution',network:'mainnet',withdrawalsEnabled:false,
    releaseId:'release-1',gitSha:'b'.repeat(40),workerDeploymentId:'worker-1',frontendDeploymentId:'frontend-1',schemaVersion:'034'}
  const release={...runtime,exchange:'BITGET',accountRefHash:'a'.repeat(64),allowedProducts:['BTC-USDT'],
    maxOrderNotional:'100',maxDailyNotional:'1000',startsAt:'2026-10-05T09:00:00.000Z',expiresAt:'2026-10-05T11:00:00.000Z',
    status:'ACTIVE',securityReviewRef:'security-1',complianceReviewRef:'compliance-1'}
  // The persisted release does not contain runtime-only feature switches.
  const {artifact,network,withdrawalsEnabled,...record}=release
  void artifact;void network;void withdrawalsEnabled
  return {release:record,runtime,loadRelease:async()=>({release:record,runtime}),clock:()=>new Date('2026-10-05T10:00:00.000Z')}
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

test('scoped admission derives release hash, timestamp and exact limits from reloaded server evidence',async()=>{
  const f=fixture();try {
    const loader=releaseLoader(), result=await f.store.claimWithRelease(scopedClaim(),loader)
    const row=f.db.prepare('SELECT * FROM live_dispatch_admission').get()!
    assert.equal(row.release_evidence_hash,await canonicalHash(loader.release))
    assert.equal(row.release_id,'release-1');assert.equal(row.claimed_at,'2026-10-05T10:00:00.000Z')
    assert.equal(result.usedAndReservedNotional,'100');assert.equal(result.executionAllowed,false)
    assert.equal(result.automaticRetryAllowed,false)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_budget_receipt').get()!.n,1)
  }finally{f.db.close()}
})
test('scoped admission cannot accept a supplied allowance, time, release hash or larger limit',async()=>{
  const f=fixture();try {
    let loaded=0;const loader=releaseLoader(), original=loader.loadRelease
    loader.loadRelease=async()=>{loaded++;return original()}
    for(const field of ['dailyExposure','claimedAt','releaseEvidenceHash','maxOrderNotional','maxDailyNotional']) {
      await assert.rejects(f.store.claimWithRelease({...scopedClaim(),[field]:'forged'} as any,loader),/SCOPED_INPUT_INVALID/)
    }
    assert.equal(loaded,0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
  }finally{f.db.close()}
})
test('scoped concurrent attempts use current durable exposure rather than a stale release-policy read',async()=>{
  const f=fixture();try {
    const loader=releaseLoader();loader.release.maxDailyNotional='200'
    const results=await Promise.allSettled(Array.from({length:20},(_,i)=>f.store.claimWithRelease(scopedClaim(i),loader)))
    assert.equal(results.filter(r=>r.status==='fulfilled').length,2)
    assert.equal(f.store.getDailyExposure(loader.clock().toISOString()).usedAndReservedNotional,'200')
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,2)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_budget_receipt').get()!.n,2)
  }finally{f.db.close()}
})
test('a replacement release or smaller freshly loaded limits cannot reset earlier reservations',async()=>{
  const f=fixture();try {
    const loader=releaseLoader();await f.store.claimWithRelease(scopedClaim(),loader)
    loader.release.maxOrderNotional='50'
    await assert.rejects(f.store.claimWithRelease(scopedClaim(2),loader),/ORDER_LIMIT/)
    loader.release.maxOrderNotional='100';loader.release.maxDailyNotional='150'
    loader.release.releaseId='release-2';loader.runtime.releaseId='release-2'
    await assert.rejects(f.store.claimWithRelease(scopedClaim(2),loader),/RELEASE_SCOPE_DENIED/)
    assert.equal(f.store.getDailyExposure(loader.clock().toISOString()).usedAndReservedNotional,'100')
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,1)
  }finally{f.db.close()}
})
test('scoped account, product, source, deployments, schema, revocation and expiry mismatches leave no claim',async()=>{
  const f=fixture();try {
    for(const changed of [{accountRefHash:'c'.repeat(64)},{exchange:'BTCC'},{allowedProducts:['ETH-USDT']},
      {gitSha:'c'.repeat(40)},{workerDeploymentId:'different'},{frontendDeploymentId:'different'},{schemaVersion:'old'},
      {status:'REVOKED'},{expiresAt:'2026-10-05T10:00:00.000Z'}]) {
      const loader=releaseLoader();Object.assign(loader.release,changed)
      await assert.rejects(f.store.claimWithRelease(scopedClaim(),loader),/RELEASE_SCOPE_DENIED/)
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
  }finally{f.db.close()}
})
test('missing, failed and malformed release loaders and unsafe runtime cannot claim',async()=>{
  const f=fixture();try {
    await assert.rejects(f.store.claimWithRelease(scopedClaim(),{} as any),/LOADER_REQUIRED/)
    await assert.rejects(f.store.claimWithRelease(scopedClaim(),{...releaseLoader(),loadRelease:async()=>{throw Error('sensitive upstream details')}}),/^Error: LIVE_DISPATCH_RELEASE_UNAVAILABLE$/)
    await assert.rejects(f.store.claimWithRelease(scopedClaim(),{...releaseLoader(),loadRelease:async()=>({release:null,runtime:releaseLoader().runtime})}),/RELEASE_UNAVAILABLE/)
    for(const changed of [{artifact:'live-candidate'},{network:'testnet'},{withdrawalsEnabled:true}]) {
      const loader=releaseLoader();Object.assign(loader.runtime,changed)
      await assert.rejects(f.store.claimWithRelease(scopedClaim(),loader),/RELEASE_SCOPE_DENIED/)
    }
    for(const changed of [{maxOrderNotional:100},{maxDailyNotional:'1e5'},{allowedProducts:['x'.repeat(1000)]}]) {
      const loader=releaseLoader();Object.assign(loader.release,changed)
      await assert.rejects(f.store.claimWithRelease(scopedClaim(),loader),/RELEASE_INVALID|AMOUNT_INVALID/)
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
  }finally{f.db.close()}
})
test('release clock is checked after reload and again immediately before claim',async()=>{
  const f=fixture();try {
    const base=Date.parse('2026-10-05T10:00:00.000Z')
    for(const times of [[base,base+2000],[base,base-1],[base,base,base+2000]]) {
      let i=0;const loader={...releaseLoader(),clock:()=>new Date(times[Math.min(i++,times.length-1)])}
      await assert.rejects(f.store.claimWithRelease(scopedClaim(),loader),/RELOAD_TIMEOUT/)
    }
    const loader=releaseLoader();loader.release.expiresAt=new Date(base+1000).toISOString()
    let i=0;loader.clock=()=>new Date([base,base+500,base+1000][Math.min(i++,2)])
    await assert.rejects(f.store.claimWithRelease(scopedClaim(),loader),/RELEASE_SCOPE_DENIED/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
  }finally{f.db.close()}
})
test('invalid clocks and UTC-day change during release admission cannot reserve against the previous day',async()=>{
  const f=fixture();try {
    for(const clock of [()=>new Date('invalid'),()=>0 as any]) {
      await assert.rejects(f.store.claimWithRelease(scopedClaim(),{...releaseLoader(),clock}),/CLOCK_INVALID/)
    }
    const loader=releaseLoader();loader.release.expiresAt='2026-10-06T01:00:00.000Z'
    const before=Date.parse('2026-10-05T23:59:59.500Z'),after=Date.parse('2026-10-06T00:00:00.000Z')
    let i=0;loader.clock=()=>new Date([before,before,after][Math.min(i++,2)])
    await assert.rejects(f.store.claimWithRelease(scopedClaim(),loader),/RELOAD_TIMEOUT/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
  }finally{f.db.close()}
})
test('timed-out release lookup resolving later cannot leave an orphan claim even with a constant injected clock',async()=>{
  const f=fixture();try {
    let finish!:(value:Awaited<ReturnType<ReturnType<typeof releaseLoader>['loadRelease']>>)=>void
    const loader=releaseLoader(), lookup=new Promise<Awaited<ReturnType<typeof loader.loadRelease>>>(resolve=>{finish=resolve})
    await assert.rejects(f.store.claimWithRelease(scopedClaim(),{...loader,loadRelease:()=>lookup}),/RELOAD_TIMEOUT/)
    finish(await loader.loadRelease());await new Promise(resolve=>setTimeout(resolve,20))
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_budget_receipt').get()!.n,0)
  }finally{f.db.close()}
})
test('scoped input snapshot cannot be rebound while the release lookup awaits',async()=>{
  const f=fixture();try {
    const loader=releaseLoader(), command=scopedClaim()
    let finish!:(value:Awaited<ReturnType<typeof loader.loadRelease>>)=>void
    const lookup=new Promise<Awaited<ReturnType<typeof loader.loadRelease>>>(resolve=>{finish=resolve})
    const pending=f.store.claimWithRelease(command,{...loader,loadRelease:()=>lookup})
    command.notional='1';command.orderId='another-order';command.productId='ETH-USDT'
    finish(await loader.loadRelease());await pending
    const row=f.db.prepare('SELECT order_id,notional FROM live_dispatch_admission').get()!
    assert.equal(row.order_id,'order-1');assert.equal(row.notional,'100')
  }finally{f.db.close()}
})
test('scoped persistence failure rolls back all evidence and identical successful attempts never replay',async()=>{
  const f=fixture();try {
    f.failWrite();await assert.rejects(f.store.claimWithRelease(scopedClaim(),releaseLoader()),/interrupted/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_admission').get()!.n,0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM live_dispatch_budget_receipt').get()!.n,0)
    f.recover();await f.store.claimWithRelease(scopedClaim(),releaseLoader())
    await assert.rejects(f.store.claimWithRelease(scopedClaim(),releaseLoader()),/ALREADY_CLAIMED/)
  }finally{f.db.close()}
})
test('scoped cancel allocates zero budget but still requires release scope and durable integrity',async()=>{
  const f=fixture();try {
    f.store.claim({...claim(),claimedAt:'2026-10-05T10:00:00.000Z'})
    const cancel={...scopedClaim(2),orderId:'order-1',operation:'CANCEL' as const,notional:null}
    const result=await f.store.claimWithRelease(cancel,releaseLoader())
    assert.equal(result.usedAndReservedNotional,'100')
    const revoked=releaseLoader();revoked.release.status='REVOKED'
    await assert.rejects(f.store.claimWithRelease({...cancel,attemptId:'other',idempotencyKey:'other',orderId:'other'},revoked),/RELEASE_SCOPE_DENIED/)
    f.db.exec("UPDATE live_dispatch_daily_exposure SET used_and_reserved_notional='0'")
    await assert.rejects(f.store.claimWithRelease({...cancel,attemptId:'other',idempotencyKey:'other',orderId:'other'},releaseLoader()),/BUDGET_INTEGRITY/)
  }finally{f.db.close()}
})
