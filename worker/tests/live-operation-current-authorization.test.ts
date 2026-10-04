import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { reloadCurrentTradingAuthority, type CurrentTradingAuthorityInput } from '../src/live/live-operation-current-authorization.ts'

const AT = '2026-10-04T10:00:00.000Z'
function fixture(operation: 'PLACE' | 'CANCEL' = 'PLACE') {
  const db = new DatabaseSync(':memory:')
  for (const file of ['007_live_exchange_projections.sql', '010_live_authorization.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  }
  db.prepare(`INSERT INTO live_exchange_accounts(exchange_account_id,exchange_name,external_account_ref_hash,status,eligible,reconciliation_clear)
    VALUES(?,?,?,'READY',1,1)`).run('account-1','BITGET','a'.repeat(64))
  db.prepare(`INSERT INTO live_orders(internal_order_id,exchange_account_id,client_order_id,product_id,side,order_type,state,
    requested_quote_notional,configuration_version,created_at,updated_at) VALUES('order-1','account-1','client-1','BTC-USDT','BUY','MARKET',?,'100','v1',?,?)`)
    .run(operation === 'PLACE' ? 'RESERVED' : 'OPEN', AT, AT)
  db.prepare(`INSERT INTO live_actor_roles(actor_id,role,scope_type,scope_key,granted_by,granted_at)
    VALUES('actor-1','TRADER','ACCOUNT','account-1','admin',?)`).run(AT)
  db.prepare(`INSERT INTO live_step_up_sessions VALUES('session-1','actor-1','mfa','AAL2','trading',?,?,NULL,?)`)
    .run('2026-10-04T09:59:00.000Z','2026-10-04T10:01:00.000Z','c'.repeat(64))
  db.prepare(`INSERT INTO live_authorization_events(authorization_event_id,actor_id,action,resource_type,resource_id,
    required_roles_json,actor_roles_json,step_up_required,step_up_session_id,decision,correlation_id,audit_event_hash,occurred_at)
    VALUES('authorization-1','actor-1',?,'ORDER','order-1','["TRADER"]','["TRADER"]',1,'session-1','ALLOW','correlation-1',?,?)`)
    .run(operation === 'PLACE' ? 'CREATE_ORDER' : 'CANCEL_ORDER','b'.repeat(64),AT)
  let readCount=0, unavailable=false
  const env={DB:{prepare(query:string) {return {bind(...params: any[]) {return {query,params}}}},
    async batch(statements: {query:string;params:any[]}[]) {
      readCount++; if(unavailable) throw Error('injected D1 unavailable')
      db.exec('BEGIN');try {
        const rows=statements.map(s=>({success:true,results:db.prepare(s.query).all(...s.params)}))
        db.exec('COMMIT');return rows
      }catch(error){db.exec('ROLLBACK');throw error}
    }} as unknown as D1Database}
  const input:CurrentTradingAuthorityInput={actorId:'actor-1',authorizationEventId:'authorization-1',
    authorizationAuditHash:'b'.repeat(64),stepUpSessionId:'session-1',orderId:'order-1',accountId:'account-1',
    accountRefHash:'a'.repeat(64),exchange:'BITGET',productId:'BTC-USDT',operation}
  return {db,env,input,clock:()=>new Date(AT),reads:()=>readCount,fail:()=>{unavailable=true}}
}

test('one transactional current snapshot satisfies authorization without granting execution',async()=>{
  const f=fixture();try {
    const result=await reloadCurrentTradingAuthority(f.env,f.input,f.clock)
    assert.equal(f.reads(),1);assert.equal(result.currentAuthorizationSatisfied,true)
    assert.equal(result.executionAllowed,false);assert.equal(result.automaticRetryAllowed,false)
    assert.match(result.authorityHash,/^[a-f0-9]{64}$/);assert.ok(Object.isFrozen(result))
  }finally{f.db.close()}
})
test('historical ALLOW cannot bypass current role revocation or changed account scope',async()=>{
  for(const change of ["revoked_at='2026-10-04T10:00:00.000Z'","scope_key='another-account'","role='VIEWER'",
    "expires_at='2026-10-04T10:00:00.000Z'"]) {
    const f=fixture();try {
      await reloadCurrentTradingAuthority(f.env,f.input,f.clock)
      f.db.exec(`UPDATE live_actor_roles SET ${change}`)
      await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,f.clock),/AUTHORIZATION_DENIED/)
      assert.equal(f.db.prepare('SELECT decision FROM live_authorization_events').get()!.decision,'ALLOW')
    }finally{f.db.close()}
  }
})
test('revoked, expired, wrong actor, wrong audience and future step-up fail closed',async()=>{
  for(const change of ["revoked_at='2026-10-04T10:00:00.000Z'","expires_at='2026-10-04T10:00:00.000Z'",
    "actor_id='other'","audience='operations'","issued_at='2026-10-04T10:00:01.000Z'",
    "issued_at='2026-10-04T09:59:00Z'"]) {
    const f=fixture();try {
      f.db.exec(`UPDATE live_step_up_sessions SET ${change}`)
      await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,f.clock),/CURRENT_TRADING_/)
    }finally{f.db.close()}
  }
})
test('event identity and persisted account, provider, product must match exact requested scope',async()=>{
  for(const change of [{actorId:'other'},{authorizationAuditHash:'d'.repeat(64)},{stepUpSessionId:'other'},
    {operation:'CANCEL'},{accountRefHash:'e'.repeat(64)},{exchange:'BTCC'},{productId:'ETH-USDT'},{orderId:'other'}]) {
    const f=fixture();try {
      await assert.rejects(reloadCurrentTradingAuthority(f.env,{...f.input,...change} as CurrentTradingAuthorityInput,f.clock),/CURRENT_TRADING_/)
    }finally{f.db.close()}
  }
})
test('place requires eligible reconciled account and unsent reserved order',async()=>{
  for(const sql of ["UPDATE live_exchange_accounts SET status='READ_ONLY'","UPDATE live_exchange_accounts SET eligible=0",
    "UPDATE live_exchange_accounts SET reconciliation_clear=0","UPDATE live_orders SET state='RISK_APPROVED'",
    "UPDATE live_orders SET exchange_order_id='provider-1'","UPDATE live_orders SET settled=1",
    "UPDATE live_orders SET pending_cancel=1"]) {
    const f=fixture();try {
      f.db.exec(sql);await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,f.clock),/ORDER_NOT_ELIGIBLE/)
    }finally{f.db.close()}
  }
})
test('protective cancel remains authorized under account halt but terminal and pending cancels are rejected',async()=>{
  const f=fixture('CANCEL');try {
    f.db.exec("UPDATE live_exchange_accounts SET status='HALTED',eligible=0,reconciliation_clear=0; UPDATE live_actor_roles SET role='RISK_OPERATOR'")
    assert.equal((await reloadCurrentTradingAuthority(f.env,f.input,f.clock)).currentAuthorizationSatisfied,true)
    for(const state of ['FILLED','CANCELLED','RECOVERY_REQUIRED']) {
      f.db.prepare('UPDATE live_orders SET state=?').run(state)
      await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,f.clock),/ORDER_NOT_ELIGIBLE/)
    }
    f.db.exec("UPDATE live_orders SET state='OPEN',pending_cancel=1")
    await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,f.clock),/ORDER_NOT_ELIGIBLE/)
  }finally{f.db.close()}
})
test('unavailable authority and slow or invalid trusted clock cannot produce authorization evidence',async()=>{
  const f=fixture();try {
    await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,()=>new Date(NaN)),/CLOCK_INVALID/)
    assert.equal(f.reads(),0)
    let count=0
    await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,()=>new Date(Date.parse(AT)+(count++ ? 2001:0))),/AUTHORITY_STALE/)
    f.fail();await assert.rejects(reloadCurrentTradingAuthority(f.env,f.input,f.clock),/AUTHORITY_UNAVAILABLE/)
  }finally{f.db.close()}
})
