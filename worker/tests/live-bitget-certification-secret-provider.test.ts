import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BitgetCertificationSecretBindingError,
  BitgetCertificationSecretsStoreProvider,
  type BitgetCertificationSecretsStoreEnv,
  type CloudflareSecretsStoreSecret,
} from '../src/live/adapters/bitget/certification-secret-provider.ts'

function binding(value: string, calls: { count: number }): CloudflareSecretsStoreSecret {
  return {
    async get() {
      calls.count += 1
      return value
    },
  }
}

test('certification provider reads each account secret once into frozen request-local material', async () => {
  const calls = { count: 0 }
  const provider = new BitgetCertificationSecretsStoreProvider({
    BITGET_CERT_API_KEY: binding(' fixture-api-key ', calls),
    BITGET_CERT_API_SECRET: binding(' fixture-api-secret ', calls),
    BITGET_CERT_API_PASSPHRASE: binding(' fixture-passphrase ', calls),
  })

  const secrets = await provider.read()

  assert.deepEqual(secrets, {
    apiKey: 'fixture-api-key',
    secretKey: 'fixture-api-secret',
    passphrase: 'fixture-passphrase',
  })
  assert.equal(Object.isFrozen(secrets), true)
  assert.equal(calls.count, 3)
})

test('missing, empty, and failed bindings fail closed without provider details', async () => {
  const valid = { count: 0 }
  const baseEnv: BitgetCertificationSecretsStoreEnv = {
    BITGET_CERT_API_KEY: binding('fixture-api-key', valid),
    BITGET_CERT_API_SECRET: binding('fixture-api-secret', valid),
    BITGET_CERT_API_PASSPHRASE: binding('fixture-passphrase', valid),
  }

  await assert.rejects(
    new BitgetCertificationSecretsStoreProvider({
      ...baseEnv,
      BITGET_CERT_API_KEY: undefined,
    } as unknown as BitgetCertificationSecretsStoreEnv).read(),
    BitgetCertificationSecretBindingError,
  )

  await assert.rejects(
    new BitgetCertificationSecretsStoreProvider({
      ...baseEnv,
      BITGET_CERT_API_SECRET: binding('   ', { count: 0 }),
    }).read(),
    /BITGET_CERT_API_SECRET is unavailable/,
  )

  await assert.rejects(
    new BitgetCertificationSecretsStoreProvider({
      ...baseEnv,
      BITGET_CERT_API_PASSPHRASE: {
        async get() {
          throw new Error('upstream detail must not escape')
        },
      },
    }).read(),
    (error: unknown) => {
      assert.ok(error instanceof BitgetCertificationSecretBindingError)
      assert.equal(error.message, 'BITGET_CERT_API_PASSPHRASE is unavailable')
      assert.equal(error.message.includes('upstream detail'), false)
      return true
    },
  )
})
