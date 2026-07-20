export const CERTIFICATION_BACKEND_HEALTH_ROUTE = '/api/certification/backend-health' as const;

export type CertificationBackendHealthSnapshot = {
  schemaVersion: 'certification-backend-health.v1';
  readOnly: true;
  checkedAt: string;
  target: {
    configured: boolean;
    source: string;
    host: string;
  };
  result: {
    state: string;
    reachable: boolean;
    healthy: boolean;
    statusCode: number | null;
    latencyMs: number;
  };
  responseBodyRead: false;
  retriesAttempted: 0;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseBackendHealth(value: unknown): CertificationBackendHealthSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 'certification-backend-health.v1' || value.readOnly !== true) {
    throw new Error('Backend health diagnostic has an invalid envelope');
  }

  const target = value.target;
  const result = value.result;
  if (
    !isRecord(target) ||
    typeof target.configured !== 'boolean' ||
    typeof target.source !== 'string' ||
    typeof target.host !== 'string'
  ) {
    throw new Error('Backend health diagnostic has invalid target metadata');
  }

  if (
    !isRecord(result) ||
    typeof result.state !== 'string' ||
    typeof result.reachable !== 'boolean' ||
    typeof result.healthy !== 'boolean' ||
    (typeof result.statusCode !== 'number' && result.statusCode !== null) ||
    typeof result.latencyMs !== 'number'
  ) {
    throw new Error('Backend health diagnostic has an invalid result');
  }

  if (value.responseBodyRead !== false || value.retriesAttempted !== 0 || typeof value.checkedAt !== 'string') {
    throw new Error('Backend health diagnostic violated its read-only contract');
  }

  return value as CertificationBackendHealthSnapshot;
}

export async function fetchCertificationBackendHealth(
  signal: AbortSignal,
): Promise<CertificationBackendHealthSnapshot> {
  const response = await fetch(CERTIFICATION_BACKEND_HEALTH_ROUTE, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Backend health diagnostic returned HTTP ${response.status}`);
  }

  return parseBackendHealth(await response.json());
}
