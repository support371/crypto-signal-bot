import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'

test('actual SQLite Durable Object constructs and enforces named scope through the private artifact',async()=>{
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/index_reviewed_coordinator.ts',import.meta.url))],
    bundle:true,format:'esm',target:'es2022',write:false})
  const mf=new Miniflare(convertV4MiniflareOptions({name:"reviewed-local",modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2024-01-01',
    compatibilityFlags:['nodejs_compat'],durableObjects:{EXCHANGE_ACCOUNT_COORDINATOR:{className:'ExchangeAccountCoordinator',useSQLite:true}},
    d1Databases:{DB:'candidate-local'},bindings:{CANDIDATE_ACCOUNTING_TOKEN:'fixture-internal-key'}}))
  try{
    const publicResponse=await mf.dispatchFetch('https://private/reviewed/orders/complete',{method:'POST',body:'{}'})
    assert.equal(publicResponse.status,404)
    const namespace=await mf.getDurableObjectNamespace('EXCHANGE_ACCOUNT_COORDINATOR')
    const stub=namespace.get(namespace.idFromName('bitget-local-account'))
    const request=(body:string,token='fixture-internal-key')=>({method:'POST',
      headers:{'X-Candidate-Accounting-Token':token},body})
    // A 400 proves the real constructor and named-scope gate succeeded before
    // JSON validation. No D1/order/financial evidence is seeded for this test.
    for(const path of ['/candidate/orders/complete','/candidate/reservations/settle','/candidate/recovery-accounting/dispatch']){
      const invalid=await stub.fetch(`https://coordinator${path}`,request('{}'))
      assert.equal(invalid.status,400,`${path}: ${await invalid.text()}`)
      assert.equal((await stub.fetch(`https://coordinator${path}`,request('{}','wrong'))).status,401)
    }
    const unnamed=namespace.get(namespace.newUniqueId())
    assert.equal((await unnamed.fetch('https://coordinator/candidate/orders/complete',request('{}'))).status,503)
  }finally{await mf.dispose()}
})
