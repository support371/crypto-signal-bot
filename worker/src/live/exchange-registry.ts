export type CanonicalExecutionExchange = 'BTCC' | 'BITGET'
export type OptionalMarketDataExchange = 'COINBASE'

export interface ExchangeProviderDescriptor {
  id: CanonicalExecutionExchange | OptionalMarketDataExchange
  executionPriority: number | null
  executionDefault: boolean
  marketDataOnly: boolean
  candidateExecutionEnabled: false
  candidateWithdrawalsEnabled: false
  implementationStatus: 'FOUNDATION' | 'READ_ONLY_CONTRACTS' | 'OPTIONAL_PUBLIC_DATA'
  mutationAvailability: 'EXTERNAL_BLOCKER' | 'CERTIFICATION_REQUIRED' | 'READ_ONLY'
  mutationBlocker: string
  automaticFailoverAllowed: false
}

export const DEFAULT_EXECUTION_EXCHANGE_ORDER = Object.freeze([
  'BTCC',
  'BITGET',
] as const satisfies readonly CanonicalExecutionExchange[])

export const EXCHANGE_PROVIDERS = Object.freeze({
  BTCC: {
    id: 'BTCC',
    executionPriority: 1,
    executionDefault: true,
    marketDataOnly: false,
    candidateExecutionEnabled: false,
    candidateWithdrawalsEnabled: false,
    implementationStatus: 'FOUNDATION',
    mutationAvailability: 'EXTERNAL_BLOCKER',
    mutationBlocker: 'BTCC_CURRENT_PROVIDER_CONTRACT_UNVERIFIED',
    automaticFailoverAllowed: false,
  },
  BITGET: {
    id: 'BITGET',
    executionPriority: 2,
    executionDefault: true,
    marketDataOnly: false,
    candidateExecutionEnabled: false,
    candidateWithdrawalsEnabled: false,
    implementationStatus: 'READ_ONLY_CONTRACTS',
    mutationAvailability: 'CERTIFICATION_REQUIRED',
    mutationBlocker: 'BITGET_RUNTIME_CERTIFICATION_AND_RELEASE_REQUIRED',
    automaticFailoverAllowed: false,
  },
  COINBASE: {
    id: 'COINBASE',
    executionPriority: null,
    executionDefault: false,
    marketDataOnly: true,
    candidateExecutionEnabled: false,
    candidateWithdrawalsEnabled: false,
    implementationStatus: 'OPTIONAL_PUBLIC_DATA',
    mutationAvailability: 'READ_ONLY',
    mutationBlocker: 'MARKET_DATA_PROVIDER_ONLY',
    automaticFailoverAllowed: false,
  },
} as const satisfies Record<string, ExchangeProviderDescriptor>)

const EXECUTION_ALIASES: Readonly<Record<string, CanonicalExecutionExchange>> = Object.freeze({
  BTCC: 'BTCC',
  BITGET: 'BITGET',
  BITGATE: 'BITGET',
})

export class UnsupportedExecutionExchange extends Error {
  readonly requestedExchange: string

  constructor(requestedExchange: string) {
    super(
      `Unsupported execution exchange: ${requestedExchange}. `
      + `Allowed defaults are ${DEFAULT_EXECUTION_EXCHANGE_ORDER.join(', ')}`,
    )
    this.name = 'UnsupportedExecutionExchange'
    this.requestedExchange = requestedExchange
  }
}

export function normalizeExecutionExchange(value: unknown): CanonicalExecutionExchange {
  const normalized = String(value ?? '').trim().toUpperCase()
  const resolved = EXECUTION_ALIASES[normalized]
  if (!resolved) throw new UnsupportedExecutionExchange(normalized || '(empty)')
  return resolved
}

export function resolveExecutionExchangeOrder(
  configuredPrimary?: unknown,
  configuredSecondary?: unknown,
): readonly CanonicalExecutionExchange[] {
  const primary = configuredPrimary === undefined || String(configuredPrimary).trim() === ''
    ? DEFAULT_EXECUTION_EXCHANGE_ORDER[0]
    : normalizeExecutionExchange(configuredPrimary)
  const secondary = configuredSecondary === undefined || String(configuredSecondary).trim() === ''
    ? DEFAULT_EXECUTION_EXCHANGE_ORDER[1]
    : normalizeExecutionExchange(configuredSecondary)

  if (primary === secondary) return Object.freeze([primary])
  return Object.freeze([primary, secondary])
}

export function isDefaultExecutionExchange(value: unknown): value is CanonicalExecutionExchange {
  try {
    return DEFAULT_EXECUTION_EXCHANGE_ORDER.includes(normalizeExecutionExchange(value))
  } catch {
    return false
  }
}
