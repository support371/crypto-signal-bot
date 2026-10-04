import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { inspectReviewedDeploymentResources, reviewedResourceConfig,
  validateReviewedResourceIsolation } from '../../scripts/verify-reviewed-deployment-resources.mjs'
const account='d944e40760494a6843e521cd57c15dfd'
const dbId='12345678-1234-1234-1234-123456789abc'
const kvId='b'.repeat(32)
const config={dbId,kvId,bucketName:'candidate-isolated-bucket',gatewayDbId:dbId,
  databaseName:'crypto-signal-bot-live-candidate-db',gatewayDatabaseName:'crypto-signal-bot-live-candidate-db',
  candidateWorker:'crypto-signal-bot-live-candidate',coordinatorWorker:'crypto-signal-bot-live-candidate',gatewayPrivate:true}
const environment={CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'private-fixture-token'}
function fixture(path:string) {
  if(path.includes('/d1/database/'))return{uuid:dbId,name:config.databaseName}
  if(path.includes('/storage/kv/'))return[{id:kvId,title:'candidate-only'}]
  if(path.includes('/r2/buckets/'))return{name:config.bucketName}
  return{bindings:[{name:'EXCHANGE_ACCOUNT_COORDINATOR',type:'durable_object_namespace',
    class_name:'ExchangeAccountCoordinator',namespace_id:'local-namespace'}, {name:'DB',type:'d1',id:dbId}]}
}

test('resource verification uses only authenticated bounded GET metadata and never certifies activation',async()=>{
  const requests:string[]=[]
  const result=await inspectReviewedDeploymentResources(config,{environment,requireCoordinator:true,
    fetcher:async(url:string,options:RequestInit)=>{
      assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer private-fixture-token')
      assert.ok(url.startsWith(`https://api.cloudflare.com/client/v4/accounts/${account}/`))
      requests.push(url);return Response.json({success:true,result:fixture(url)})
    }})
  assert.equal(requests.length,4)
  assert.equal(result.deployedCoordinator,true)
  assert.equal(result.providerCertificationVerified,false);assert.equal(result.mainnetActivationVerified,false)
  assert.doesNotMatch(JSON.stringify(result),/private-fixture-token/)
})

test('wrong account, placeholders, production reuse and cross-worker bindings fail before network',async()=>{
  for(const change of [{dbId:'00000000-0000-0000-0000-000000000000'}, {kvId:'0'.repeat(32)},
    {dbId:'6046c4fd-87de-4b56-be9d-917d6994a86b'}, {kvId:'2dcb1050b9c846a7bba8cd1c3c43df62'},
    {bucketName:'crypto-signal-bot-storage'}, {gatewayDbId:'aaaaaaaa-1234-1234-1234-123456789abc'},
    {coordinatorWorker:'crypto-signal-bot-api'}, {gatewayPrivate:false}]){
    let calls=0
    await assert.rejects(()=>inspectReviewedDeploymentResources({...config,...change},{environment,
      fetcher:async()=>{calls++;throw new Error('must not request')}}))
    assert.equal(calls,0)
  }
  await assert.rejects(()=>inspectReviewedDeploymentResources(config,{environment:{...environment,
    CLOUDFLARE_ACCOUNT_ID:'5918df72bfd0d0389a1894adec5db58f'}}),/Deployment blocked/)
  await assert.rejects(()=>inspectReviewedDeploymentResources(config,{environment:{CLOUDFLARE_ACCOUNT_ID:account}}),/AUTH_REQUIRED/)
})

test('missing or mismatched deployed coordinator, D1 and storage metadata cannot pass',async()=>{
  for(const bad of ['db','kv','bucket','coordinator','coordinator-db','permissions','api-error','malformed']){
    await assert.rejects(()=>inspectReviewedDeploymentResources(config,{environment,requireCoordinator:true,
      fetcher:async(url:string)=>{
        if(bad==='permissions')return Response.json({errors:[{message:'private-fixture-token'}]},{status:403})
        if(bad==='api-error')return Response.json({success:false,errors:[{message:'private-fixture-token'}]})
        if(bad==='malformed')return new Response('private-fixture-token')
        let result=fixture(url)
        if(bad==='db'&&url.includes('/d1/'))result={...result,uuid:'another-database'}
        if(bad==='kv'&&url.includes('/kv/'))result=[]
        if(bad==='bucket'&&url.includes('/r2/'))result={name:'other-bucket'}
        if(bad==='coordinator'&&url.includes('/settings'))result={bindings:[]}
        if(bad==='coordinator-db'&&url.includes('/settings'))result={bindings:[...(result.bindings??[]).filter((b)=>b.name!=='DB')]}
        return Response.json({success:true,result})
      }}),(error:Error)=>{assert.doesNotMatch(error.message,/private-fixture-token/);return true},bad)
  }
})

test('checked-in templates stay private and fail closed on placeholder storage IDs',()=>{
  const candidate=fs.readFileSync(new URL('../../wrangler.live-candidate.toml',import.meta.url),'utf8')
  const gateway=fs.readFileSync(new URL('../../wrangler.reviewed-operations.toml',import.meta.url),'utf8')
  const parsed=reviewedResourceConfig(candidate,gateway)
  assert.equal(parsed.gatewayPrivate,true)
  assert.equal(parsed.dbId,parsed.gatewayDbId)
  assert.throws(()=>validateReviewedResourceIsolation(parsed),/NOT_CONFIGURED/)
  assert.equal(reviewedResourceConfig(candidate,gateway.replace('workers_dev = false','workers_dev = true')).gatewayPrivate,false)
  assert.throws(()=>reviewedResourceConfig(candidate+ '\ndatabase_id="unexpected"\n',gateway),/AMBIGUOUS/)
})

test('oversized API metadata is cancelled and cannot expose upstream contents',async()=>{
  let cancelled=0
  await assert.rejects(()=>inspectReviewedDeploymentResources(config,{environment,
    fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(131073))},cancel(){cancelled++}}))}),/INSPECTION_UNAVAILABLE/)
  assert.equal(cancelled,3)
})

test('projection-only preflight verifies the same private namespace without requiring provider storage',async()=>{
  const {reviewedCoordinatorConfig}=await import('../../scripts/verify-reviewed-deployment-resources.mjs')
  const coordinator=fs.readFileSync(new URL('../../wrangler.reviewed-coordinator.toml',import.meta.url),'utf8')
    .replace('00000000-0000-0000-0000-000000000000',dbId)
  const gateway=fs.readFileSync(new URL('../../wrangler.reviewed-operations.toml',import.meta.url),'utf8')
    .replace('00000000-0000-0000-0000-000000000000',dbId)
  const parsed=reviewedCoordinatorConfig(coordinator,gateway)
  assert.equal(parsed.profile,'PROJECTION_ONLY')
  let calls=0
  const result=await inspectReviewedDeploymentResources(parsed,{environment,requireCoordinator:true,
    fetcher:async(url:string)=>{calls++;assert.ok(!url.includes('/kv/')&&!url.includes('/r2/'))
      return Response.json({success:true,result:fixture(url)})}})
  assert.equal(calls,2);assert.equal(result.deployedCoordinator,true)
  assert.equal(result.mainnetActivationVerified,false)
  assert.equal(parsed.candidateWorker,'crypto-signal-bot-live-candidate')
  assert.throws(()=>validateReviewedResourceIsolation({...parsed,dbId:'6046c4fd-87de-4b56-be9d-917d6994a86b'}),/PRODUCTION_RESOURCE/)
})

test('isolated migration preparation excludes production paths and verifies empty application plus tracked replay',async()=>{
  const {reviewedMigrationNames,reviewedMigrationFiles}=await import('../../scripts/prepare-reviewed-migrations.mjs')
  const {DatabaseSync}=await import('node:sqlite')
  const directory=new URL('../migrations/',import.meta.url)
  const names=reviewedMigrationNames(fs.readdirSync(directory))
  assert.equal(names.length,31)
  const files=reviewedMigrationFiles(names)
  assert.equal(new Set(files.map((f)=>f.target.split('_')[0])).size,31)
  assert.ok(files.findIndex((f)=>f.source==='018_live_recovery_accounting_approval.sql')<files.findIndex((f)=>f.source==='018_live_recovery_accounting_dispatch.sql'))
  assert.ok(names.every((n)=>!/^00[12]_|^031_|^032_/.test(n)))
  assert.throws(()=>reviewedMigrationNames(names.filter((n)=>!n.startsWith('034_'))),/INCOMPLETE/)
  const db=new DatabaseSync(':memory:')
  try{
    db.exec('PRAGMA foreign_keys=ON;CREATE TABLE d1_migrations (name TEXT PRIMARY KEY)')
    for(let pass=0;pass<2;pass++)for(const name of names){
      if(db.prepare('SELECT name FROM d1_migrations WHERE name=?').get(name))continue
      db.exec('BEGIN')
      try{db.exec(fs.readFileSync(new URL(name,directory),'utf8'))
        db.prepare('INSERT INTO d1_migrations VALUES (?)').run(name);db.exec('COMMIT')
      }catch(error){db.exec('ROLLBACK');throw error}
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get()!.n,31)
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='live_partial_fill_reservation_releases'").get())
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='managed_users'").get(),undefined)
  }finally{db.close()}
})


test('coordinator-only artifact keeps the same namespace and exposes no public command',async()=>{
  const {default:artifact}=await import('../src/index_reviewed_coordinator.ts')
  const result=artifact.fetch()
  assert.equal(result.status,404)
  const status=await result.json() as any
  assert.equal(status.publicCommands,false);assert.equal(status.providerMutationAllowed,false);assert.equal(status.executionAllowed,false)
  const text=fs.readFileSync(new URL('../../wrangler.reviewed-coordinator.toml',import.meta.url),'utf8')
  assert.match(text,/name = "crypto-signal-bot-live-candidate"/)
  assert.match(text,/tag = "v1"/)
  assert.match(text,/new_sqlite_classes = \["ExchangeAccountCoordinator"\]/)
  assert.doesNotMatch(text,/secrets_store_secrets|kv_namespaces|r2_buckets|^routes\s*=|^crons\s*=/m)
})
