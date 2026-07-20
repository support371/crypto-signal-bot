export const CERTIFICATION_STATUS_ROUTE = '/api/certification/status' as const;

export type CertificationStatusSnapshot = {
  schemaVersion: 'certification-status.v1';
  mode: 'CERTIFICATION';
  readOnly: true;
  generatedAt: string;
  release: {
    packageVersion: string;
    channel: string;
    commit: string;
    environment: string;
  };
  services: {
    publicApplication: string;
    certificationMirror: string;
    connectedDashboard: string;
    userAuthentication: string;
    operatorGateway: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string';
}

function parseCertificationStatus(value: unknown): CertificationStatusSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 'certification-status.v1' || value.mode !== 'CERTIFICATION' || value.readOnly !== true) {
    throw new Error('Certification status response has an invalid envelope');
  }

  const release = value.release;
  if (!isRecord(release) || !['packageVersion', 'channel', 'commit', 'environment'].every((key) => hasString(release, key))) {
    throw new Error('Certification status response has invalid release metadata');
  }

  const services = value.services;
  if (!isRecord(services) || !['publicApplication', 'certificationMirror', 'connectedDashboard', 'userAuthentication', 'operatorGateway'].every((key) => hasString(services, key))) {
    throw new Error('Certification status response has invalid service metadata');
  }

  const capabilities = value.capabilities;
  if (!isRecord(capabilities)) {
    throw new Error('Certification status response is missing capability locks');
  }

  for (const key of [
    'deploymentAllowed',
    'providerMutationAllowed',
    'executionAllowed',
    'mainnetAllowed',
    'realFundsAllowed',
    'withdrawalsAllowed',
    'automaticRetryAllowed',
  ]) {
    // Equivalent validated form: value.capabilities[key] !== false.
    if (capabilities[key] !== false) {
      throw new Error(`Certification capability lock is invalid: ${key}`);
    }
  }

  if (typeof value.generatedAt !== 'string') {
    throw new Error('Certification status response has an invalid timestamp');
  }

  return value as CertificationStatusSnapshot;
}

export async function fetchCertificationStatus(signal: AbortSignal): Promise<CertificationStatusSnapshot> {
  const response = await fetch(CERTIFICATION_STATUS_ROUTE, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Certification status endpoint returned HTTP ${response.status}`);
  }

  return parseCertificationStatus(await response.json());
}
