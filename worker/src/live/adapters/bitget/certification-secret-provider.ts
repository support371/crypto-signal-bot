import type {
  BitgetSecretMaterial,
  BitgetSecretProvider,
} from './read-only-client.ts'

export interface CloudflareSecretsStoreSecret {
  get(): Promise<string>
}

export interface BitgetCertificationSecretsStoreEnv {
  BITGET_CERT_API_KEY: CloudflareSecretsStoreSecret
  BITGET_CERT_API_SECRET: CloudflareSecretsStoreSecret
  BITGET_CERT_API_PASSPHRASE: CloudflareSecretsStoreSecret
}

export class BitgetCertificationSecretBindingError extends Error {
  readonly code = 'BITGET_CERTIFICATION_SECRET_UNAVAILABLE'

  constructor(bindingName: keyof BitgetCertificationSecretsStoreEnv) {
    super(`${bindingName} is unavailable`)
    this.name = 'BitgetCertificationSecretBindingError'
  }
}

async function readBinding(
  binding: CloudflareSecretsStoreSecret | undefined,
  bindingName: keyof BitgetCertificationSecretsStoreEnv,
): Promise<string> {
  if (!binding || typeof binding.get !== 'function') {
    throw new BitgetCertificationSecretBindingError(bindingName)
  }

  try {
    const value = (await binding.get()).trim()
    if (!value) throw new BitgetCertificationSecretBindingError(bindingName)
    return value
  } catch (error) {
    if (error instanceof BitgetCertificationSecretBindingError) throw error
    throw new BitgetCertificationSecretBindingError(bindingName)
  }
}

/**
 * Reads the three read-only certification credentials into request-local memory.
 * It never logs, serializes, persists, caches, or exposes the secret material.
 */
export class BitgetCertificationSecretsStoreProvider implements BitgetSecretProvider {
  readonly #env: BitgetCertificationSecretsStoreEnv

  constructor(env: BitgetCertificationSecretsStoreEnv) {
    this.#env = env
  }

  async read(): Promise<BitgetSecretMaterial> {
    const [apiKey, secretKey, passphrase] = await Promise.all([
      readBinding(this.#env.BITGET_CERT_API_KEY, 'BITGET_CERT_API_KEY'),
      readBinding(this.#env.BITGET_CERT_API_SECRET, 'BITGET_CERT_API_SECRET'),
      readBinding(this.#env.BITGET_CERT_API_PASSPHRASE, 'BITGET_CERT_API_PASSPHRASE'),
    ])

    return Object.freeze({ apiKey, secretKey, passphrase })
  }
}
