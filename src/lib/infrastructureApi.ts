export type CapabilityStatus = 'healthy' | 'degraded' | 'halted' | 'unavailable' | 'not_reported';
export type FreshnessClass = 'green' | 'amber' | 'red' | 'not_reported';
export type StateAuthority = 'legacy_d1' | 'shadow_durable_object' | 'portfolio_durable_object' | 'not_reported';

type JsonRecord = Record<string, unknown>;

export interface RuntimeSafetyState {
  tradingMode: string;
  exchangeMode: string;
  network: string;
  allowMainnet: boolean;
  liveTradingEnabled: boolean;
  withdrawalsEnabled: boolean;
}

export interface GuardianState {
  status: CapabilityStatus;
  halted: boolean;
  reason: string | null;
  drawdownPct: number | null;
  maxDrawdownPct: number | null;
}

export interface FeedCapabilityState {
  source: string;
  channel: string;
  symbol: string;
  integrity: CapabilityStatus;
  freshness: FreshnessClass;
  eventAgeMs: number | null;
  sequenceState: string;
  heartbeatState: string;
  gapCount: number | null;
}

export interface FastPathState {
  authority: StateAuthority;
  targetAuthority: 'portfolio_durable_object';
  shadowMode: boolean;
  decisionLatencyMs: number | null;
  decisionDataAgeMs: number | null;
  ledgerAtomicityFailures: number | null;
  queueStatus: CapabilityStatus;
  projectionLagMs: number | null;
}

export interface InfrastructureSnapshot {
  backendBaseUrl: string | null;
  backendReachable: boolean;
  generatedAt: string;
  sourceContract: 'v2' | 'legacy' | 'unavailable';
  runtime: RuntimeSafetyState;
  guardian: GuardianState;
  feeds: FeedCapabilityState[];
  fastPath: FastPathState;
  paperSafetyOk: boolean;
  gaps: string[];
  error: string | null;
}

const EMPTY_RUNTIME: RuntimeSafetyState = {
  tradingMode: 'not_reported',
  exchangeMode: 'not_reported',
  network: 'not_reported',
  allowMainnet: false,
  liveTradingEnabled: false,
  withdrawalsEnabled: false,
};

const EMPTY_GUARDIAN: GuardianState = {
  status: 'not_reported',
  halted: false,
  reason: null,
  drawdownPct: null,
  maxDrawdownPct: null,
};

const EMPTY_FAST_PATH: FastPathState = {
  authority: 'not_reported',
  targetAuthority: 'portfolio_durable_object',
  shadowMode: false,
  decisionLatencyMs: null,
  decisionDataAgeMs: null,
  ledgerAtomicityFailures: null,
  queueStatus: 'not_reported',
  projectionLagMs: null,
};

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function readString(record: JsonRecord, keys: string[], fallback = 'not_reported'): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

function readBoolean(record: JsonRecord, keys: string[], fallback = false): boolean {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return fallback;
}

function readNumber(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed.slice(0, -4) : trimmed;
}

export function getInfrastructureBackendUrl(): string | null {
  const candidates = [
    import.meta.env.VITE_BACKEND_URL,
    import.meta.env.VITE_CRYPTOCORE_API_BASE,
    import.meta.env.VITE_API_BASE_URL,
  ];
  const configured = candidates.find((value) => typeof value === 'string' && value.trim());
  return configured ? normalizeBaseUrl(configured) : null;
}

export function classifyDataAge(
  eventAgeMs: number | null,
  integrity: CapabilityStatus,
): FreshnessClass {
  if (eventAgeMs === null) return 'not_reported';
  if (integrity !== 'healthy') return 'red';
  if (eventAgeMs <= 500) return 'green';
  if (eventAgeMs <= 1500) return 'amber';
  return 'red';
}

async function fetchJson(baseUrl: string, path: string, timeoutMs = 5000): Promise<JsonRecord> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    return asRecord(await response.json());
  } finally {
    window.clearTimeout(timeout);
  }
}

function normalizeCapability(value: unknown): CapabilityStatus {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'healthy' || normalized === 'ok' || normalized === 'connected' || normalized === 'live_public') return 'healthy';
  if (normalized === 'degraded' || normalized === 'resyncing') return 'degraded';
  if (normalized === 'halted' || normalized === 'triggered') return 'halted';
  if (normalized === 'unavailable' || normalized === 'offline' || normalized === 'error') return 'unavailable';
  return 'not_reported';
}

function normalizeAuthority(value: unknown): StateAuthority {
  const normalized = String(value ?? '');
  if (normalized === 'legacy_d1' || normalized === 'shadow_durable_object' || normalized === 'portfolio_durable_object') {
    return normalized;
  }
  return 'not_reported';
}

function parseRuntime(record: JsonRecord): RuntimeSafetyState {
  return {
    tradingMode: readString(record, ['trading_mode', 'mode']),
    exchangeMode: readString(record, ['exchange_mode']),
    network: readString(record, ['network']),
    allowMainnet: readBoolean(record, ['allow_mainnet']),
    liveTradingEnabled: readBoolean(record, ['live_trading_enabled']),
    withdrawalsEnabled: readBoolean(record, ['withdrawals_enabled']),
  };
}

function parseGuardian(record: JsonRecord): GuardianState {
  const halted = readBoolean(record, ['halted', 'triggered', 'guardian_triggered']);
  return {
    status: halted ? 'halted' : normalizeCapability(record.status ?? (Object.keys(record).length ? 'healthy' : 'not_reported')),
    halted,
    reason: readString(record, ['reason', 'kill_switch_reason'], '') || null,
    drawdownPct: readNumber(record, ['drawdown_pct']),
    maxDrawdownPct: readNumber(record, ['max_drawdown_pct', 'guardian_max_drawdown']),
  };
}

function parseFeeds(record: JsonRecord): FeedCapabilityState[] {
  const feedValues = Array.isArray(record.feeds) ? record.feeds : [];
  return feedValues.map((value) => {
    const feed = asRecord(value);
    const integrity = normalizeCapability(feed.integrity_state ?? feed.status);
    const eventAgeMs = readNumber(feed, ['event_age_ms']);
    return {
      source: readString(feed, ['source'], 'unknown'),
      channel: readString(feed, ['channel'], 'not_reported'),
      symbol: readString(feed, ['symbol'], 'all'),
      integrity,
      freshness: (readString(feed, ['freshness_class'], '') as FreshnessClass) || classifyDataAge(eventAgeMs, integrity),
      eventAgeMs,
      sequenceState: readString(feed, ['sequence_state']),
      heartbeatState: readString(feed, ['heartbeat_state']),
      gapCount: readNumber(feed, ['gap_count']),
    };
  });
}

function isPaperSafetyOk(runtime: RuntimeSafetyState): boolean {
  return runtime.tradingMode === 'paper'
    && runtime.exchangeMode === 'paper'
    && runtime.network === 'testnet'
    && !runtime.allowMainnet
    && !runtime.liveTradingEnabled
    && !runtime.withdrawalsEnabled;
}

export function buildInfrastructureGaps(snapshot: Pick<InfrastructureSnapshot, 'feeds' | 'fastPath'>): string[] {
  const gaps: string[] = [];
  if (!snapshot.feeds.length) gaps.push('WebSocket feed integrity is not reported');
  if (!snapshot.feeds.some((feed) => feed.sequenceState !== 'not_reported')) gaps.push('Sequence continuity is not reported');
  if (!snapshot.feeds.some((feed) => feed.heartbeatState !== 'not_reported')) gaps.push('Heartbeat health is not reported');
  if (snapshot.fastPath.authority !== 'portfolio_durable_object') gaps.push('Per-portfolio Durable Object is not the active state authority');
  if (snapshot.fastPath.decisionLatencyMs === null) gaps.push('Decision latency is not reported');
  if (snapshot.fastPath.decisionDataAgeMs === null) gaps.push('Decision data age is not reported');
  if (snapshot.fastPath.queueStatus === 'not_reported') gaps.push('Asynchronous projection Queue is not reported');
  if (snapshot.fastPath.ledgerAtomicityFailures === null) gaps.push('Ledger atomicity metric is not reported');
  return gaps;
}

function createUnavailableSnapshot(baseUrl: string | null, error: string): InfrastructureSnapshot {
  const snapshot: InfrastructureSnapshot = {
    backendBaseUrl: baseUrl,
    backendReachable: false,
    generatedAt: new Date().toISOString(),
    sourceContract: 'unavailable',
    runtime: EMPTY_RUNTIME,
    guardian: EMPTY_GUARDIAN,
    feeds: [],
    fastPath: EMPTY_FAST_PATH,
    paperSafetyOk: false,
    gaps: [],
    error,
  };
  snapshot.gaps = buildInfrastructureGaps(snapshot);
  return snapshot;
}

async function readV2Snapshot(baseUrl: string): Promise<InfrastructureSnapshot> {
  const result = await fetchJson(baseUrl, '/v2/infrastructure/status');
  const runtime = parseRuntime(asRecord(result.runtime));
  const guardian = parseGuardian(asRecord(result.guardian));
  const fastPathRecord = asRecord(result.fast_path);
  const projections = asRecord(result.projections);
  const feeds = parseFeeds(result);
  const snapshot: InfrastructureSnapshot = {
    backendBaseUrl: baseUrl,
    backendReachable: true,
    generatedAt: readString(result, ['generated_at'], new Date().toISOString()),
    sourceContract: 'v2',
    runtime,
    guardian,
    feeds,
    fastPath: {
      authority: normalizeAuthority(fastPathRecord.authority),
      targetAuthority: 'portfolio_durable_object',
      shadowMode: readBoolean(fastPathRecord, ['shadow_mode']),
      decisionLatencyMs: readNumber(fastPathRecord, ['decision_latency_ms']),
      decisionDataAgeMs: readNumber(fastPathRecord, ['decision_data_age_ms']),
      ledgerAtomicityFailures: readNumber(fastPathRecord, ['ledger_atomicity_failures']),
      queueStatus: normalizeCapability(projections.queue_status),
      projectionLagMs: readNumber(projections, ['projection_lag_ms']),
    },
    paperSafetyOk: isPaperSafetyOk(runtime),
    gaps: [],
    error: null,
  };
  snapshot.gaps = buildInfrastructureGaps(snapshot);
  return snapshot;
}

async function readLegacySnapshot(baseUrl: string): Promise<InfrastructureSnapshot> {
  const [runtimeResult, guardianResult, feedResult] = await Promise.allSettled([
    fetchJson(baseUrl, '/runtime/status'),
    fetchJson(baseUrl, '/guardian/status'),
    fetchJson(baseUrl, '/market/feed/status'),
  ]);
  const runtimeRecord = runtimeResult.status === 'fulfilled' ? runtimeResult.value : {};
  const guardianRecord = guardianResult.status === 'fulfilled' ? guardianResult.value : {};
  const feedRecord = feedResult.status === 'fulfilled' ? feedResult.value : {};
  if (!Object.keys(runtimeRecord).length && !Object.keys(guardianRecord).length && !Object.keys(feedRecord).length) {
    throw new Error('Legacy infrastructure endpoints are unavailable');
  }
  const runtime = parseRuntime(runtimeRecord);
  const guardian = parseGuardian(guardianRecord);
  const legacySource = readString(feedRecord, ['primary', 'market_data_source'], 'not_reported');
  const legacyStatus = normalizeCapability(feedRecord.status);
  const feeds = legacySource === 'not_reported'
    ? []
    : [{
        source: legacySource,
        channel: 'not_reported',
        symbol: 'all',
        integrity: legacyStatus,
        freshness: 'not_reported' as const,
        eventAgeMs: null,
        sequenceState: 'not_reported',
        heartbeatState: 'not_reported',
        gapCount: null,
      }];
  const snapshot: InfrastructureSnapshot = {
    backendBaseUrl: baseUrl,
    backendReachable: true,
    generatedAt: new Date().toISOString(),
    sourceContract: 'legacy',
    runtime,
    guardian,
    feeds,
    fastPath: {
      ...EMPTY_FAST_PATH,
      authority: 'legacy_d1',
    },
    paperSafetyOk: isPaperSafetyOk(runtime),
    gaps: [],
    error: null,
  };
  snapshot.gaps = buildInfrastructureGaps(snapshot);
  return snapshot;
}

export async function readInfrastructureSnapshot(): Promise<InfrastructureSnapshot> {
  const baseUrl = getInfrastructureBackendUrl();
  if (!baseUrl) {
    return createUnavailableSnapshot(null, 'Set VITE_BACKEND_URL to expose infrastructure status');
  }
  try {
    return await readV2Snapshot(baseUrl);
  } catch {
    try {
      return await readLegacySnapshot(baseUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backend infrastructure status is unavailable';
      return createUnavailableSnapshot(baseUrl, message);
    }
  }
}
