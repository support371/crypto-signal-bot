import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { certificationStoreConfig, inspectCertificationStore } from '../../scripts/verify-bitget-secret-store-resources.mjs'

const environment = {CLOUDFLARE_ACCOUNT_ID:'d944e40760494a6843e521cd57c15dfd', CLOUDFLARE_API_TOKEN:'fixture-secret-not-for-output'}
const text = fs.readFileSync(new URL('../../wrangler.live-candidate.toml', import.meta.url), 'utf8')
const config = certificationStoreConfig(text)
const rows = config.secretNames.map((name:string) => ({name, scopes:['workers']}))

test('declared certification store names match metadata without reading values or certifying activation', async () => {
  let calls=0
  const report=await inspectCertificationStore(config,{environment,fetcher:async(url:string,options:RequestInit)=>{
    calls++; assert.equal(options.method,'GET'); assert.ok(url.endsWith(`/secrets_store/stores/${config.storeId}/secrets?page=1&per_page=100`))
    assert.equal(options.headers.Authorization,`Bearer ${environment.CLOUDFLARE_API_TOKEN}`)
    return Response.json({success:true,result:rows})
  }})
  assert.equal(calls,1); assert.equal(report.secretValuesRead,false)
  assert.equal(report.providerCertificationVerified,false); assert.equal(report.mainnetActivationVerified,false)
  assert.doesNotMatch(JSON.stringify(report),/fixture-secret-not-for-output/)
})

test('wrong account, ambiguous configs and placeholder store fail before network', async () => {
  for(const invalid of [text.replaceAll(config.storeId,'0'.repeat(32)),text.replace('binding = "BITGET_CERT_API_KEY"','binding = "BITGET_TRADE_API_KEY"'),
    text.replace('secret_name = "BITGET_CERT_API_KEY"','secret_name = "different"'),text+'\n[[secrets_store_secrets]]\nbinding="duplicate"\n']) {
    assert.throws(()=>certificationStoreConfig(invalid),/CONFIG_INVALID/)
  }
  let calls=0
  await assert.rejects(()=>inspectCertificationStore(config,{environment:{...environment,CLOUDFLARE_ACCOUNT_ID:'5918df72bfd0d0389a1894adec5db58f'},fetcher:async()=>{calls++;throw Error('unexpected')}}),/Deployment blocked/)
  assert.equal(calls,0)
})

test('missing store, denied access, missing secrets and wrong Worker scope have distinct safe errors', async () => {
  for(const [response,code] of [
    [new Response('fixture-secret-not-for-output',{status:404}),'STORE_NOT_FOUND'],
    [new Response('fixture-secret-not-for-output',{status:403}),'ACCESS_DENIED'],
    [Response.json({success:true,result:[]}), 'CERTIFICATION_SECRET_MISSING'],
    [Response.json({success:true,result:rows.map((r:any)=>({...r,scopes:[]}))}), 'WORKER_SCOPE_MISSING'],
  ] as const){
    await assert.rejects(()=>inspectCertificationStore(config,{environment,fetcher:async()=>response}), (error:Error)=>{
      assert.match(error.message,new RegExp(code));assert.doesNotMatch(error.message,/fixture-secret-not-for-output/);return true
    })
  }
})

test('paginated metadata is fully inspected and duplicate names are rejected', async () => {
  let calls=0
  const filler=Array.from({length:100},(_,i)=>({name:`other-${i}`,scopes:['workers']}))
  await inspectCertificationStore(config,{environment,fetcher:async()=>{
    calls++
    return Response.json({success:true,result:calls===1?filler:rows,result_info:{page:calls,per_page:100,total_count:103}})
  }})
  assert.equal(calls,2)
  await assert.rejects(()=>inspectCertificationStore(config,{environment,fetcher:async()=>Response.json({success:true,result:[...rows,rows[0]]})}),/DUPLICATE/)
})

test('malformed, oversized and upstream error bodies never enter output', async () => {
  for(const response of [new Response('fixture-secret-not-for-output'),Response.json({success:false,errors:[{message:'fixture-secret-not-for-output'}]}),
    new Response('x'.repeat(131073))]){
    await assert.rejects(()=>inspectCertificationStore(config,{environment,fetcher:async()=>response}),(error:Error)=>{
      assert.match(error.message,/PROVIDER_SECRET_METADATA_/);assert.doesNotMatch(error.message,/fixture-secret-not-for-output/);return true
    })
  }
})

test('stalled fetch or streaming body is bounded even when fetch ignores abort', async () => {
  await assert.rejects(()=>inspectCertificationStore(config,{environment,timeoutMs:10,fetcher:()=>new Promise(()=>{})}),/TIMEOUT/)
  let cancelled=false
  await assert.rejects(()=>inspectCertificationStore(config,{environment,timeoutMs:10,fetcher:async()=>new Response(new ReadableStream({cancel(){cancelled=true}}))}),/TIMEOUT/)
  assert.equal(cancelled,true)
})

test('upstream exceptions cannot bypass error redaction with an internal-looking prefix', async () => {
  await assert.rejects(()=>inspectCertificationStore(config,{environment,fetcher:async()=>{throw Error('PROVIDER_SECRET_fixture-secret-not-for-output')}}),
    (error:Error)=>{assert.equal(error.message,'PROVIDER_SECRET_METADATA_UNAVAILABLE');return true})
})
