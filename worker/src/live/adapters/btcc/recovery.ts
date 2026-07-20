import { canonicalHash } from '../../canonical-json.ts'
import {
  BtccApiManifestUnavailable,
  validateBtccReadOnlyManifest,
  type BtccReadOnlyApiManifest,
  type BtccReadOnlyEndpointDefinition,
} from './contract.ts'

export type BtccRecoveryCapability =
  | 'active_orders_snapshot'
  | 'order_history_snapshot'
  | 'fill_history_snapshot'

export interface BtccRecoveryEndpointBinding {
  capability: BtccRecoveryCapability
  endpointName: string
  method: 'GET'
  path: string
}

export interface BtccRecoveryContract {
  exchange: 'BTCC'
  officialGuideRevision: string
  restOrigin: string
  manifestSha256: string
  endpoints: Readonly<Record<BtccRecoveryCapability, BtccRecoveryEndpointBinding>>
  endpointSchemaImported: true
  readOnly: true
  providerMutationAllowed: false
  executionAllowed: false
}

export interface BtccRecoverySnapshotEvidence {
  capability: BtccRecoveryCapability
  snapshotId: string
  snapshotHash: string
  observedAt: string
  windowStartAt: string
  windowEndAt: string
  itemCount: number
  maximumItems: number
  complete: true
  bounded: true
  manifestSha256: string
  officialGuideRevision: string
  providerMutationAllowed: false
  executionAllowed: false
}

export interface BtccRecoverySnapshotInput {
  capability: BtccRecoveryCapability
  snapshotId: string
  observedAt: string
  windowStartAt: string
  windowEndAt: string
  itemCount: number
  maximumItems: number
  complete: boolean
  bounded: boolean
  payload: unknown
}

const REQUIRED_CAPABILITIES: readonly BtccRecoveryCapability[] = Object.freeze([
  'active_orders_snapshot',
  'order_history_snapshot',
  'fill_history_snapshot',
])

function required(value: string, field: string): string {
  const normalized = value.trim()
  if (!normalized) throw new BtccApiManifestUnavailable(`${field} is required`)
  return normalized
}

function timestamp(value: string, field: string): string {
  const normalized = required(value, field)
  const parsed = Date.parse(normalized)
  if (!Number.isFinite(parsed)) {
    throw new BtccApiManifestUnavailable(`${field} must be ISO-8601`)
  }
  return new Date(parsed).toISOString()
}

function capabilityEndpoint(
  byName: ReadonlyMap<string, BtccReadOnlyEndpointDefinition>,
  capability: BtccRecoveryCapability,
): BtccRecoveryEndpointBinding {
  const endpoint = byName.get(capability)
  if (!endpoint) {
    throw new BtccApiManifestUnavailable(
      `BTCC recovery capability is missing from the reviewed manifest: ${capability}`,
    )
  }
  return Object.freeze({
    capability,
    endpointName: capability,
    method: endpoint.method,
    path: endpoint.path,
  })
}

export function validateBtccRecoveryManifest(
  manifest: BtccReadOnlyApiManifest | null | undefined,
): BtccRecoveryContract {
  const validated = validateBtccReadOnlyManifest(manifest)
  const byName = new Map<string, BtccReadOnlyEndpointDefinition>()
  for (const endpoint of validated.endpoints) {
    byName.set(endpoint.name.trim(), endpoint)
  }

  const endpoints = Object.freeze({
    active_orders_snapshot: capabilityEndpoint(byName, 'active_orders_snapshot'),
    order_history_snapshot: capabilityEndpoint(byName, 'order_history_snapshot'),
    fill_history_snapshot: capabilityEndpoint(byName, 'fill_history_snapshot'),
  })

  return Object.freeze({
    exchange: 'BTCC',
    officialGuideRevision: validated.officialGuideRevision,
    restOrigin: validated.restOrigin,
    manifestSha256: validated.manifestSha256,
    endpoints,
    endpointSchemaImported: true,
    readOnly: true,
    providerMutationAllowed: false,
    executionAllowed: false,
  })
}

export async function buildBtccRecoverySnapshotEvidence(
  contract: BtccRecoveryContract,
  input: BtccRecoverySnapshotInput,
): Promise<BtccRecoverySnapshotEvidence> {
  const endpoint = contract.endpoints[input.capability]
  if (!endpoint || endpoint.method !== 'GET') {
    throw new BtccApiManifestUnavailable(
      `BTCC recovery capability is not available in the reviewed manifest: ${input.capability}`,
    )
  }
  if (!input.complete) {
    throw new BtccApiManifestUnavailable('BTCC recovery snapshot must be complete')
  }
  if (!input.bounded) {
    throw new BtccApiManifestUnavailable('BTCC recovery snapshot must be bounded')
  }
  if (!Number.isSafeInteger(input.maximumItems) || input.maximumItems < 1) {
    throw new BtccApiManifestUnavailable('maximumItems must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.itemCount) || input.itemCount < 0) {
    throw new BtccApiManifestUnavailable('itemCount must be a non-negative safe integer')
  }
  if (input.itemCount > input.maximumItems) {
    throw new BtccApiManifestUnavailable('BTCC recovery snapshot exceeds the reviewed bound')
  }

  const observedAt = timestamp(input.observedAt, 'observedAt')
  const windowStartAt = timestamp(input.windowStartAt, 'windowStartAt')
  const windowEndAt = timestamp(input.windowEndAt, 'windowEndAt')
  if (Date.parse(windowEndAt) <= Date.parse(windowStartAt)) {
    throw new BtccApiManifestUnavailable('BTCC recovery window must be increasing')
  }
  if (Date.parse(observedAt) < Date.parse(windowEndAt)) {
    throw new BtccApiManifestUnavailable('BTCC recovery observation cannot precede its window end')
  }

  const snapshotId = required(input.snapshotId, 'snapshotId')
  const snapshotHash = await canonicalHash({
    exchange: 'BTCC',
    capability: input.capability,
    endpointName: endpoint.endpointName,
    endpointMethod: endpoint.method,
    endpointPath: endpoint.path,
    manifestSha256: contract.manifestSha256,
    officialGuideRevision: contract.officialGuideRevision,
    snapshotId,
    observedAt,
    windowStartAt,
    windowEndAt,
    itemCount: input.itemCount,
    maximumItems: input.maximumItems,
    complete: true,
    bounded: true,
    payload: input.payload,
    providerMutationAllowed: false,
    executionAllowed: false,
  })

  return Object.freeze({
    capability: input.capability,
    snapshotId,
    snapshotHash,
    observedAt,
    windowStartAt,
    windowEndAt,
    itemCount: input.itemCount,
    maximumItems: input.maximumItems,
    complete: true,
    bounded: true,
    manifestSha256: contract.manifestSha256,
    officialGuideRevision: contract.officialGuideRevision,
    providerMutationAllowed: false,
    executionAllowed: false,
  })
}

export function requiredBtccRecoveryCapabilities(): readonly BtccRecoveryCapability[] {
  return REQUIRED_CAPABILITIES
}
