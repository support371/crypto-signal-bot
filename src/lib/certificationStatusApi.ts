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

function parseCertificationStatus(value: unknown): CertificationStatusSnapshot {
  if (!isRecord(value)) {
    throw new Error('Certification status response has an invalid envelope');
  }

  const root: Record<string, unknown> = value;
  if (root.schemaVersion !== 'certification-status.v1' || root.mode !== 'CERTIFICATION' || root.readOnly !== true) {
    throw new Error('Certification status response has an invalid envelope');
  }

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
  if (typeof generatedAt !== 'string') {
    throw new Error('Certification status response has an invalid timestamp');
  }

  return {
    schemaVersion: 'certification-status.v1',
    mode: 'CERTIFICATION',
    readOnly: true,
    generatedAt,
    release: {
      packageVersion: requireString(release, 'packageVersion'),
      channel: requireString(release, 'channel'),
      commit: requireString(release, 'commit'),
      environment: requireString(release, 'environment'),
    },
    services: {
      publicApplication: requireString(services, 'publicApplication'),
      certificationMirror: requireString(services, 'certificationMirror'),
      connectedDashboard: requireString(services, 'connectedDashboard'),
      userAuthentication: requireString(services, 'userAuthentication'),
      operatorGateway: requireString(services, 'operatorGateway'),
    },
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
