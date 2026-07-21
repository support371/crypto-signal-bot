import { afterEach, describe, expect, it, vi } from 'vitest';
import { CERTIFICATION_STATUS_ROUTE, fetchCertificationStatus } from '../lib/certificationStatusApi';

const VALID_SNAPSHOT = {
  schemaVersion: 'certification-status.v1',
  mode: 'CERTIFICATION',
  readOnly: true,
  generatedAt: '2026-07-21T01:34:01.652Z',
  release: {
    packageVersion: '0.0.0',
    channel: 'preview-candidate',
    commit: 'fc01c50313ef',
    environment: 'preview',
  },
  services: {
    publicApplication: 'available',
    certificationMirror: 'available',
    connectedDashboard: 'external-health-required',
    userAuthentication: 'configuration-required',
    operatorGateway: 'disconnected',
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
} as const;

function responseWith(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('certification status client', () => {
  it('accepts a valid read-only snapshot and uses a credential-free bounded request contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseWith(VALID_SNAPSHOT));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchCertificationStatus(controller.signal)).resolves.toEqual(VALID_SNAPSHOT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(CERTIFICATION_STATUS_ROUTE, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
  });

  it('rejects a response that enables any locked capability', async () => {
    const payload = {
      ...VALID_SNAPSHOT,
      capabilities: {
        ...VALID_SNAPSHOT.capabilities,
        executionAllowed: true,
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWith(payload)));

    await expect(fetchCertificationStatus(new AbortController().signal)).rejects.toThrow(
      'Certification capability lock is invalid: executionAllowed',
    );
  });

  it('rejects malformed nested response data', async () => {
    const payload = {
      ...VALID_SNAPSHOT,
      services: 'not-an-object',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWith(payload)));

    await expect(fetchCertificationStatus(new AbortController().signal)).rejects.toThrow(
      'Certification status response has an invalid object field: services',
    );
  });

  it('rejects a non-success HTTP response without parsing a snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(responseWith({ error: 'unavailable' }, 503)));

    await expect(fetchCertificationStatus(new AbortController().signal)).rejects.toThrow(
      'Certification status endpoint returned HTTP 503',
    );
  });
});
