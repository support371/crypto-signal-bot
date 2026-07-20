export interface BtccReadOnlyEndpointDefinition {
  name: string
  method: 'GET'
  path: string
}

export interface BtccReadOnlyApiManifest {
  officialGuideRevision: string
  restOrigin: string
  manifestSha256: string
  endpoints: readonly BtccReadOnlyEndpointDefinition[]
}

export const BTCC_PRIMARY_PROVIDER = Object.freeze({
  exchange: 'BTCC',
  executionPriority: 1,
  productScope: 'FUTURES',
  candidateExecutionEnabled: false,
  candidateWithdrawalsEnabled: false,
  readOnlyManifestRequired: true,
  endpointSchemaImported: false,
} as const)

const FORBIDDEN_OPERATION_NAME = /(create|place|submit|cancel|replace|amend|withdraw|transfer|deposit)/i
const SHA256_PATTERN = /^[a-f0-9]{64}$/

export class BtccApiManifestUnavailable extends Error {
  constructor(message = 'BTCC official endpoint manifest has not been imported and reviewed') {
    super(message)
    this.name = 'BtccApiManifestUnavailable'
  }
}

export function validateBtccReadOnlyManifest(
  manifest: BtccReadOnlyApiManifest | null | undefined,
): BtccReadOnlyApiManifest {
  if (!manifest) throw new BtccApiManifestUnavailable()

  if (!/^https:\/\//i.test(manifest.restOrigin)) {
    throw new BtccApiManifestUnavailable('BTCC REST origin must use HTTPS')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.officialGuideRevision)) {
    throw new BtccApiManifestUnavailable('BTCC guide revision must use YYYY-MM-DD')
  }
  if (!SHA256_PATTERN.test(manifest.manifestSha256)) {
    throw new BtccApiManifestUnavailable('BTCC manifest hash must be lowercase SHA-256')
  }
  if (manifest.endpoints.length === 0) {
    throw new BtccApiManifestUnavailable('BTCC read-only endpoint manifest must not be empty')
  }

  const names = new Set<string>()
  for (const endpoint of manifest.endpoints) {
    const name = endpoint.name.trim()
    if (!name || FORBIDDEN_OPERATION_NAME.test(name)) {
      throw new BtccApiManifestUnavailable(`BTCC endpoint name is not read-only: ${endpoint.name}`)
    }
    if (endpoint.method !== 'GET') {
      throw new BtccApiManifestUnavailable(`BTCC endpoint must use GET: ${name}`)
    }
    if (!endpoint.path.startsWith('/') || endpoint.path.includes('://')) {
      throw new BtccApiManifestUnavailable(`BTCC endpoint path is invalid: ${endpoint.path}`)
    }
    if (FORBIDDEN_OPERATION_NAME.test(endpoint.path)) {
      throw new BtccApiManifestUnavailable(`BTCC endpoint path appears mutating: ${endpoint.path}`)
    }
    if (names.has(name)) {
      throw new BtccApiManifestUnavailable(`BTCC endpoint name is duplicated: ${name}`)
    }
    names.add(name)
  }

  return Object.freeze({
    ...manifest,
    endpoints: Object.freeze(manifest.endpoints.map((endpoint) => Object.freeze({ ...endpoint }))),
  })
}
