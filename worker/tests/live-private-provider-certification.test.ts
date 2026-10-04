import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { routePrivateBitgetCertification, type PrivateCertificationDependencies, type PrivateCertificationEnv } from '../src/live/bitget-private-certification-service.ts'
import { canonicalHash } from '../src/live/canonical-json.ts'
import { BITGET_SPOT_ENDPOINTS } from '../src/live/adapters/bitget/endpoints.ts'
import { privateCertificationConfig } from '../../scripts/verify-provider-certification-resources.mjs'

const TOKEN='internal-certification-token-'.repeat(2)
const AT=Date.parse('2026-10-04T12:00:00.000Z')
function fixture() {
  const reads={key:0,secret:0,passphrase:0},paths:string[]=[],requests:RequestInit[]=[]
  let uid='provider-user-1',authorities=['stor'],apiCode='00000',failSecrets=false,stalledSecrets=false
  const env:PrivateCertificationEnv={CERTIFICATION_RUNNER_TOKEN:TOKEN,
    BITGET_CERT_API_KEY:{get:async()=>{reads.key++;if(stalledSecrets)return new Promise(()=>{});return 'fixture-private-key'}},
    BITGET_CERT_API_SECRET:{get:async()=>{reads.secret++;if(failSecrets)throw Error('fixture-private-secret');return 'fixture-private-secret'}},
    BITGET_CERT_API_PASSPHRASE:{get:async()=>{reads.passphrase++;return 'fixture-private-passphrase'}}}
  const dependencies:PrivateCertificationDependencies={clock:()=>AT,timeoutMs:100,secretTimeoutMs:100,bodyTimeoutMs:100,
    fetcher:async(url,init)=>{
      const path=new URL(String(url)).pathname;paths.push(path);requests.push(init!)
      let data:unknown=[]
      if(path===BITGET_SPOT_ENDPOINTS.accountInfo)data={userId:uid,authorities}
      if(path===BITGET_SPOT_ENDPOINTS.symbols)data=[{symbol:'BTCUSDT',baseCoin:'BTC',quoteCoin:'USDT',status:'online',
        quantityPrecision:'8',quotePrecision:'2',pricePrecision:'2',minTradeAmount:'0.0001',maxTradeAmount:'10',minTradeUSDT:'5',lastPr:'50000'}]
      if(path===BITGET_SPOT_ENDPOINTS.accountAssets)data=[{coin:'BTC',available:'1',frozen:'0',locked:'0',uTime:String(AT)},
        {coin:'USDT',available:'1000',frozen:'0',locked:'0',uTime:String(AT)}]
      return Response.json({code:apiCode,data})
    }}
  return {env,dependencies,reads,paths,requests,writeKey:()=>{authorities=['stor','stow']},unknownPermission:()=>{authorities=['stor','future-code']},
    missingSuccess:()=>{apiCode=''},changeUid:()=>{uid='another-provider-user'},failSecrets:()=>{failSecrets=true},stallSecrets:()=>{stalledSecrets=true}}
}
function request(path='/internal/bitget/inspect',body?:unknown,token=TOKEN) {
  return new Request(`https://private-service${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)})
}
async function command() {return {runId:'run-1',exchangeAccountId:'account-1',productId:'BTC-USDT',expectedAccountRefHash:await canonicalHash('provider-user-1')}}
async function body(response:Response) {return response.json() as Promise<Record<string,any>>}
function assertRedacted(value:unknown) {
  const output=JSON.stringify(value)
  for(const token of ['fixture-private-key','fixture-private-secret','fixture-private-passphrase',TOKEN,'provider-user-1','ACCESS-SIGN','available'])assert.ok(!output.includes(token),token)
}

test('identity inspection reads each certification secret once and returns only hashed read-only evidence',async()=>{
  const f=fixture(),response=await routePrivateBitgetCertification(request(),f.env,f.dependencies),result=await body(response)
  assert.equal(response.status,200);assert.equal(result.accountRefHash,await canonicalHash('provider-user-1'))
  assert.equal(result.accountModel,'UNVERIFIED');assert.equal(result.accountModelVerified,false)
  assert.equal(result.executionAllowed,false);assert.equal(result.certifiedForLive,false)
  assert.deepEqual(f.reads,{key:1,secret:1,passphrase:1});assert.deepEqual(f.paths,[BITGET_SPOT_ENDPOINTS.accountInfo]);assertRedacted(result)
})
test('exact account-bound certification composes all eight checks using only six bounded GETs',async()=>{
  const f=fixture(),response=await routePrivateBitgetCertification(request('/internal/bitget/certify',await command()),f.env,f.dependencies),result=await body(response)
  assert.equal(response.status,200);assert.equal(result.result.status,'PASSED');assert.equal(result.result.checks.length,8)
  assert.equal(result.accountModelVerified,false);assert.equal(result.result.certifiedForLive,false)
  assert.equal(result.result.executionAllowed,false);assert.deepEqual(f.reads,{key:1,secret:1,passphrase:1})
  assert.equal(f.paths.length,6);assert.ok(f.requests.every(r=>r.method==='GET'&&r.redirect==='error'))
  assert.ok(f.paths.every(p=>Object.values(BITGET_SPOT_ENDPOINTS).includes(p as any)));assertRedacted(result)
})
test('authentication, routes and methods fail before credential reads or provider calls',async()=>{
  for(const value of [request('/internal/bitget/inspect',undefined,'wrong'),new Request('https://private-service/internal/bitget/inspect'),
    request('/internal/bitget/place-order')]) {
    const f=fixture(),response=await routePrivateBitgetCertification(value,f.env,f.dependencies)
    assert.ok([401,404,405].includes(response.status));assert.equal(f.paths.length,0);assert.deepEqual(f.reads,{key:0,secret:0,passphrase:0})
  }
  const f=fixture();delete f.env.CERTIFICATION_RUNNER_TOKEN
  assert.equal((await routePrivateBitgetCertification(request(),f.env,f.dependencies)).status,503);assert.equal(f.reads.key,0)
})
test('bad commands, extra secret-bearing fields and invalid clock fail before secrets',async()=>{
  for(const input of [{...await command(),url:'https://evil.test'},{...await command(),apiKey:'fixture-private-key'},
    {...await command(),productId:'BTC-BTC'},{...await command(),expectedAccountRefHash:'bad'},{...await command(),runId:'x'.repeat(3000)}]) {
    const f=fixture(),response=await routePrivateBitgetCertification(request('/internal/bitget/certify',input),f.env,f.dependencies)
    assert.equal(response.status,503);assert.equal(f.reads.key,0);assertRedacted(await body(response))
  }
  const f=fixture();f.dependencies.clock=()=>NaN
  assert.equal((await routePrivateBitgetCertification(request(),f.env,f.dependencies)).status,503);assert.equal(f.reads.key,0)
})
test('wrong provider identity stops after permissions GET without account data collection',async()=>{
  const f=fixture();f.changeUid()
  const response=await routePrivateBitgetCertification(request('/internal/bitget/certify',await command()),f.env,f.dependencies)
  assert.equal(response.status,403);assert.deepEqual(f.paths,[BITGET_SPOT_ENDPOINTS.accountInfo]);assertRedacted(await body(response))
})
test('write authority, unknown permission and missing success envelope never pass inspection',async()=>{
  for(const mode of ['writeKey','unknownPermission','missingSuccess'] as const) {
    const f=fixture();f[mode]()
    const response=await routePrivateBitgetCertification(request(),f.env,f.dependencies)
    assert.equal(response.status,503);assert.equal(f.paths.length,1);assertRedacted(await body(response))
  }
})
test('failed, missing and stalled bindings are bounded and cannot expose values or call provider',async()=>{
  for(const mode of ['failSecrets','stallSecrets'] as const) {
    const f=fixture();f[mode]()
    const response=await routePrivateBitgetCertification(request(),f.env,f.dependencies)
    assert.equal(response.status,503);assert.equal(f.paths.length,0);assertRedacted(await body(response))
  }
  const f=fixture();delete (f.env as any).BITGET_CERT_API_KEY
  assert.equal((await routePrivateBitgetCertification(request(),f.env,f.dependencies)).status,503)
  assert.deepEqual(f.reads,{key:0,secret:0,passphrase:0})
})
test('stalled command body cancels without reading secrets even if cancellation never resolves',async()=>{
  const f=fixture();let cancelled=false
  const stream=new ReadableStream({cancel(){cancelled=true;return new Promise<void>(()=>{})}})
  const value=new Request('https://private-service/internal/bitget/certify',{method:'POST',headers:{Authorization:`Bearer ${TOKEN}`,'Content-Type':'application/json'},body:stream,duplex:'half'} as any)
  const response=await routePrivateBitgetCertification(value,f.env,f.dependencies)
  assert.equal(response.status,503);assert.equal(cancelled,true);assert.equal(f.reads.key,0)
})
test('private certification artifact has no public exposure, trade/store persistence or financial handlers',()=>{
  const config=readFileSync(new URL('../../wrangler.provider-certification.toml',import.meta.url),'utf8')
  assert.match(config,/workers_dev = false/);assert.match(config,/preview_urls = false/)
  assert.doesNotMatch(config,/\[\[routes\]\]|\[triggers\]|\[\[d1_databases\]\]|BITGET_TRADE/)
  for(const name of ['ALLOW_MAINNET','LIVE_EXECUTION_ENABLED','WITHDRAWALS_ENABLED']) assert.match(config,new RegExp(`${name} = "false"`))
  const paper=readFileSync(new URL('../src/index.ts',import.meta.url),'utf8')
  const candidate=readFileSync(new URL('../src/index_live_candidate.ts',import.meta.url),'utf8')
  assert.doesNotMatch(paper+candidate,/bitget-private-certification-service/)
})

test('deployment preflight rejects public exposure, financial bindings and inline invocation token',()=>{
  const config=readFileSync(new URL('../../wrangler.provider-certification.toml',import.meta.url),'utf8')
  assert.match(privateCertificationConfig(config).storeId,/^[a-f0-9]{32}$/)
  for(const changed of [config.replace('workers_dev = false','workers_dev = true'),
    config.replace('LIVE_EXECUTION_ENABLED = "false"','LIVE_EXECUTION_ENABLED = "true"'),
    config+'\n[[routes]]\npattern = "example.test/*"\n',config+'\n[triggers]\ncrons = ["* * * * *"]\n',
    config+'\n[[services]]\nbinding = "FINANCIAL"\n',config.replace('[vars]','[vars]\nCERTIFICATION_RUNNER_TOKEN = "unsafe"'),
    config.replace('BITGET_CERT_API_KEY','BITGET_TRADE_API_KEY')]) {
    assert.throws(()=>privateCertificationConfig(changed),/CONFIG_INVALID/)
  }
})
