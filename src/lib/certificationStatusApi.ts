export const CERTIFICATION_STATUS_ROUTE = '/api/certification/status' as const;
export const CERTIFICATION_STATUS_STATIC_ROUTE = '/certification-status.json' as const;

const BUILD_VERSION_PATTERN = /^(\d+\.\d+\.\d+)-dev(?:\+([a-f0-9]{7,12}))?$/i;
const COMMIT_PATTERN = /^[a-f0-9]{7,12}$/i;

export type CertificationStatusSnapshot = {
  schemaVersion: 'certification-status.v1';
  mode: 'CERTIFICATION';
  readOnly: true;
  generatedAt: string;
  release: {
    packageVersion: string;
    channel: 'preview-candidate' | 'static-build-candidate';
    commit: string;
    environment: 'production' | 'preview' | 'development' | 'static' | 'unknown';
  };
  services: {
    publicApplication: 'available';
    certificationMirror: 'available' | 'static-build';
    connectedDashboard: 'external-health-required';
    userAuthentication: 'configuration-required';
    operatorGateway: 'disconnected';
  };
  capabilities: {
    deploymentAllowed: false;
    providerMutationAllowed: false;
    executionAllowed: false;
    mainnetAllowed: false;
    realFundsAllowed: false;
    withdrawalsAllowed: false;
    automaticRetryAllowed: false;
  };
};

class CertificationStatusRouteUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CertificationStatusRouteUnavailable';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new Error(`Certification status response has an invalid object field: ${key}`);
  }
  return value;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Certification status response has an invalid string field: ${key}`);
  }
  return value;
}

function requireLiteral<const T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = requireString(record, key);
  if (!allowed.includes(value as T)) {
    throw new Error(`Certification status response has an invalid literal field: ${key}`);
  }
  return value as T;
}

function parseRelease(release: Record<string, unknown>): CertificationStatusSnapshot['release'] {
  const packageVersion = requireString(release, 'packageVersion');
  const channel = requireLiteral(release, 'channel', ['preview-candidate', 'static-build-candidate'] as const);
  const commit = requireString(release, 'commit');
  const environment = requireLiteral(
    release,
    'environment',
    ['production', 'preview', 'development', 'static', 'unknown'] as const,
  );

  const versionMatch = BUILD_VERSION_PATTERN.exec(packageVersion);
  if (!versionMatch) {
    throw new Error('Certification status response has an invalid development build version');
  }

  const versionCommit = versionMatch[2]?.toLowerCase();
  if (commit === 'unknown') {
    if (versionCommit !== undefined) {
      throw new Error('Certification status response has inconsistent release identity');
    }
  } else if (!COMMIT_PATTERN.test(commit) || versionCommit !== commit.toLowerCase()) {
    throw new Error('Certification status response has inconsistent release identity');
  }

  return { packageVersion, channel, commit, environment };
}

function parseServices(services: Record<string, unknown>): CertificationStatusSnapshot['services'] {
  return {
    publicApplication: requireLiteral(services, 'publicApplication', ['available'] as const),
    certificationMirror: requireLiteral(services, 'certificationMirror', ['available', 'static-build'] as const),
    connectedDashboard: requireLiteral(services, 'connectedDashboard', ['external-health-required'] as const),
    userAuthentication: requireLiteral(services, 'userAuthentication', ['configuration-required'] as const),
    operatorGateway: requireLiteral(services, 'operatorGateway', ['disconnected'] as const),
  };
}

function parseCertificationStatus(value: unknown): CertificationStatusSnapshot {
  if (!isRecord(value)) {
    throw new Error('Certification status response has an invalid envelope');
  }

  if (value.schemaVersion !== 'certification-status.v1' || value.mode !== 'CERTIFICATION' || value.readOnly !== true) {
    throw new Error('Certification status response has an invalid envelope');
  }

  const root: Record<string, unknown> = value;
  const release = requireRecord(root, 'release');
  const services = requireRecord(root, 'services');
  const capabilities = requireRecord(root, 'capabilities');

  const capabilityKeys = [
    'deploymentAllowed',
    'providerMutationAllowed',
    'executionAllowed',
    'mainnetAllowed',
    'realFundsAllowed',
    'withdrawalsAllowed',
    'automaticRetryAllowed',
  ] as const;

  for (const key of capabilityKeys) {
    if (capabilities[key] !== false) {
      throw new Error(`Certification capability lock is invalid: ${key}`);
    }
  }

  const generatedAt = root.generatedAt;
  if (typeof generatedAt !== 'string' || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Certification status response has an invalid timestamp');
  }

  return {
    schemaVersion: 'certification-status.v1',
    mode: 'CERTIFICATION',
    readOnly: true,
    generatedAt,
    release: parseRelease(release),
    services: parseServices(services),
    capabilities: {
      deploymentAllowed: false,
      providerMutationAllowed: false,
      executionAllowed: false,
      mainnetAllowed: false,
      realFundsAllowed: false,
      withdrawalsAllowed: false,
      automaticRetryAllowed: false,
    },
  };
}

async function fetchCertificationStatusRoute(
  route: typeof CERTIFICATION_STATUS_ROUTE | typeof CERTIFICATION_STATUS_STATIC_ROUTE,
  signal: AbortSignal,
): Promise<CertificationStatusSnapshot> {
  let response: Response;

  try {
    response = await fetch(route, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CertificationStatusRouteUnavailable(`Certification status route could not be reached: ${route}`);
  }

  if (!response.ok) {
    throw new CertificationStatusRouteUnavailable(`Certification status route returned HTTP ${response.status}: ${route}`);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new CertificationStatusRouteUnavailable(`Certification status route did not return JSON: ${route}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new CertificationStatusRouteUnavailable(`Certification status route returned invalid JSON: ${route}`);
  }

  return parseCertificationStatus(payload);
}

export async function fetchCertificationStatus(signal: AbortSignal): Promise<CertificationStatusSnapshot> {
  try {
    return await fetchCertificationStatusRoute(CERTIFICATION_STATUS_ROUTE, signal);
  } catch (error) {
    if (signal.aborted || !(error instanceof CertificationStatusRouteUnavailable)) {
      throw error;
    }
  }

  return fetchCertificationStatusRoute(CERTIFICATION_STATUS_STATIC_ROUTE, signal);
}
