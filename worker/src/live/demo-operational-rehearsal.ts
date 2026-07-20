import { canonicalHash, canonicalJson } from './canonical-json.ts'

const ID = /^[A-Za-z0-9:._-]{1,128}$/
const HASH = /^[a-f0-9]{64}$/
const GIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

export const OPERATIONAL_REHEARSAL_SCENARIOS = Object.freeze([
  'ROLLBACK_TO_KNOWN_GOOD',
  'DISASTER_RECOVERY_RESTORE',
  'ACCESS_REFERENCE_ROTATION',
  'PROVIDER_OUTAGE_FAIL_CLOSED',
  'INCIDENT_ESCALATION_AND_CONTAINMENT',
] as const)

export type OperationalRehearsalScenarioName = typeof OPERATIONAL_REHEARSAL_SCENARIOS[number]

interface ZeroCapabilities {
  deploymentAllowed: false
  demoRequestAllowed: false
  credentialsRead: false
  credentialsPersisted: false
  providerMutationAllowed: false
  executionAllowed: false
  liveExecutionAllowed: false
  realFundsAllowed: false
  mainnetAllowed: false
  withdrawalsAllowed: false
  automaticRetryAllowed: false
  accountingAutomaticallyDispatched: false
}

export interface OperationalScenarioInput extends ZeroCapabilities {
  passed: boolean
  evidenceHash: string | null
  observedAt: string | null
}

export type OperationalScenarioInputs = Readonly<
  Record<OperationalRehearsalScenarioName, OperationalScenarioInput>
>

export interface OperationalRehearsalInput {
  packId: string
  gitSha: string
  scenarios: OperationalScenarioInputs
  preparedBy: string
  preparedAt: string
}

export interface OperationalScenarioEvidence extends ZeroCapabilities {
  name: OperationalRehearsalScenarioName
  passed: boolean
  evidenceHash: string | null
  evidencePresent: boolean
  observedAt: string | null
  reason: string | null
}

export interface OperationalRehearsalPack extends ZeroCapabilities {
  packId: string
  gitSha: string
  environment: 'BITGET_DEMO_CERTIFICATION'
  scenarios: readonly OperationalScenarioEvidence[]
  scenarioCount: 5
  passedCount: number
  blockers: readonly string[]
  status: 'BLOCKED' | 'READY_FOR_INDEPENDENT_REVIEW'
  readyForIndependentReview: boolean
  packHash: string
  preparedBy: string
  preparedAt: string
}

const ZERO: ZeroCapabilities = Object.freeze({
  deploymentAllowed: false,
  demoRequestAllowed: false,
  credentialsRead: false,
  credentialsPersisted: false,
  providerMutationAllowed: false,
  executionAllowed: false,
  liveExecutionAllowed: false,
  realFundsAllowed: false,
  mainnetAllowed: false,
  withdrawalsAllowed: false,
  automaticRetryAllowed: false,
  accountingAutomaticallyDispatched: false,
})

export class OperationalRehearsalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OperationalRehearsalError'
  }
}

function id(value: string, field: string): string {
  const result = String(value ?? '').trim()
  if (!ID.test(result)) throw new OperationalRehearsalError(`${field} is invalid`)
  return result
}

function time(value: string, field: string): string {
  const result = String(value ?? '').trim()
  const parsed = Date.parse(result)
  if (!result || !Number.isFinite(parsed) || new Date(parsed).toISOString() !== result) {
    throw new OperationalRehearsalError(`${field} must be canonical ISO-8601`)
  }
  return result
}

function assertZero(value: ZeroCapabilities, field: string): void {
  for (const key of Object.keys(ZERO) as (keyof ZeroCapabilities)[]) {
    if (value[key] !== false) throw new OperationalRehearsalError(`${field} must remain non-live`)
  }
}

function scenario(
  name: OperationalRehearsalScenarioName,
  value: OperationalScenarioInput,
): OperationalScenarioEvidence {
  assertZero(value, name)
  const evidenceHash = value.evidenceHash === null
    ? null
    : String(value.evidenceHash).trim().toLowerCase()
  if (evidenceHash !== null && !HASH.test(evidenceHash)) {
    throw new OperationalRehearsalError(`${name} evidence hash is invalid`)
  }
  const observedAt = value.observedAt === null ? null : time(value.observedAt, `${name} observedAt`)
  const passed = value.passed === true && evidenceHash !== null && observedAt !== null
  return Object.freeze({
    name,
    passed,
    evidenceHash,
    evidencePresent: evidenceHash !== null,
    observedAt,
    reason: passed ? null : `${name} evidence is incomplete or failed`,
    ...ZERO,
  })
}

export async function evaluateOperationalRehearsal(
  input: OperationalRehearsalInput,
): Promise<OperationalRehearsalPack> {
  const gitSha = String(input.gitSha ?? '').trim().toLowerCase()
  if (!GIT.test(gitSha)) throw new OperationalRehearsalError('gitSha is invalid')
  const scenarios = Object.freeze(OPERATIONAL_REHEARSAL_SCENARIOS.map((name) => {
    const value = input.scenarios?.[name]
    if (!value) throw new OperationalRehearsalError(`${name} is missing`)
    return scenario(name, value)
  }))
  const passedCount = scenarios.filter((item) => item.passed).length
  const blockers = Object.freeze(scenarios
    .filter((item) => !item.passed)
    .map((item) => item.reason ?? `${item.name} is blocked`))
  const ready = passedCount === 5
  const base = Object.freeze({
    packId: id(input.packId, 'packId'),
    gitSha,
    environment: 'BITGET_DEMO_CERTIFICATION' as const,
    scenarios,
    scenarioCount: 5 as const,
    passedCount,
    blockers,
    status: ready ? 'READY_FOR_INDEPENDENT_REVIEW' as const : 'BLOCKED' as const,
    readyForIndependentReview: ready,
    preparedBy: id(input.preparedBy, 'preparedBy'),
    preparedAt: time(input.preparedAt, 'preparedAt'),
    ...ZERO,
  })
  return Object.freeze({ ...base, packHash: await canonicalHash(base) })
}

export function operationalRehearsalMatches(
  left: OperationalRehearsalPack,
  right: OperationalRehearsalPack,
): boolean {
  return left.packHash === right.packHash && canonicalJson(left) === canonicalJson(right)
}
