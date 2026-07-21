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

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Certification status response has an invalid string field: ${key}`);
  }
  return value;
}

function parseCertificationStatus(value: unknown): CertificationStatusSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 'certification-status.v1' || value.mode !== 'CERTIFICATION' || value.readOnly !== true) {
    throw new Error('Certification status response has an invalid envelope');
  }

  const releaseValue = value.release;
  if (!isRecord(releaseValue)) {
    throw new Error('Certification status response has invalid release metadata');
  }

  const servicesValue = value.services;
  if (!isRecord(servicesValue)) {
    throw new Error('Certification status response has invalid service metadata');
  }

  const capabilitiesValue = value.capabilities;
  if (!isRecord(capabilitiesValue)) {
    throw new Error('Certification status response is missing capability locks');
  }

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
    if (capabilitiesValue[key] !== false) {
      throw new Error(`Certification capability lock is invalid: ${key}`);
    }
  }

  if (typeof value.generatedAt !== 'string') {
    throw new Error('Certification status response has an invalid timestamp');
  }

  return {
    schemaVersion: 'certification-status.v1',
    mode: 'CERTIFICATION',
    readOnly: true,
    generatedAt: value.generatedAt,
    release: {
      packageVersion: requireString(releaseValue, 'packageVersion'),
      channel: requireString(releaseValue, 'channel'),
      commit: requireString(releaseValue, 'commit'),
      environment: requireString(releaseValue, 'environment'),
    },
    services: {
      publicApplication: requireString(servicesValue, 'publicApplication'),
      certificationMirror: requireString(servicesValue, 'certificationMirror'),
      connectedDashboard: requireString(servicesValue, 'connectedDashboard'),
      userAuthentication: requireString(servicesValue, 'userAuthentication'),
      operatorGateway: requireString(servicesValue, 'operatorGateway'),
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
