import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CERTIFICATION_STATUS_ROUTE,
  CERTIFICATION_STATUS_STATIC_ROUTE,
  fetchCertificationStatus,
} from '../lib/certificationStatusApi';

const VALID_SNAPSHOT = {
  schemaVersion: 'certification-status.v1',
  mode: 'CERTIFICATION',
  readOnly: true,
  generatedAt: '2026-07-21T01:34:01.652Z',
  release: {
    packageVersion: '0.0.0-dev+fc01c50313ef',
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

function responseWith(
  payload: unknown,
  status = 200,
  contentType = 'application/json; charset=utf-8',
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': contentType }),
    json: async () => payload,
  } as Response;
}

function expectedRequest(signal: AbortSignal) {
  return {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
    signal,
  } as const;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('certification status client', () => {
  it('accepts the same-origin API snapshot with a credential-free request contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(responseWith(VALID_SNAPSHOT));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchCertificationStatus(controller.signal)).resolves.toEqual(VALID_SNAPSHOT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(CERTIFICATION_STATUS_ROUTE, expectedRequest(controller.signal));
  });

  it('falls back to the generated static snapshot when the API route is unavailable', async () => {
    const staticSnapshot = {
      ...VALID_SNAPSHOT,
      release: {
        ...VALID_SNAPSHOT.release,
        channel: 'static-build-candidate',
      },
      services: {
        ...VALID_SNAPSHOT.services,
        certificationMirror: 'static-build',
      },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseWith({ error: 'not found' }, 404))
      .mockResolvedValueOnce(responseWith(staticSnapshot));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await expect(fetchCertificationStatus(controller.signal)).resolves.toEqual(staticSnapshot);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, CERTIFICATION_STATUS_ROUTE, expectedRequest(controller.signal));
    expect(fetchMock).toHaveBeenNthCalledWith(2, CERTIFICATION_STATUS_STATIC_ROUTE, expectedRequest(controller.signal));
  });

  it('rejects a response that enables any locked capability without accepting the static route', async () => {
    const payload = {
      ...VALID_SNAPSHOT,
      capabilities: {
        ...VALID_SNAPSHOT.capabilities,
        executionAllowed: true,
      },
    };
    const fetchMock = vi.fn().mockResolvedValue(responseWith(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCertificationStatus(new AbortController().signal)).rejects.toThrow(
      'Certification capability lock is invalid: executionAllowed',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed nested response data without accepting the static route', async () => {
    const payload = {
      ...VALID_SNAPSHOT,
      services: 'not-an-object',
    };
    const fetchMock = vi.fn().mockResolvedValue(responseWith(payload));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCertificationStatus(new AbortController().signal)).rejects.toThrow(
      'Certification status response has an invalid object field: services',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats non-JSON API content as unavailable and uses the static snapshot', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseWith('<html>fallback shell</html>', 200, 'text/html'))
      .mockResolvedValueOnce(responseWith(VALID_SNAPSHOT));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCertificationStatus(new AbortController().signal)).resolves.toEqual(VALID_SNAPSHOT);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports failure when neither the API route nor static snapshot is available', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseWith({ error: 'unavailable' }, 503))
      .mockResolvedValueOnce(responseWith({ error: 'missing static snapshot' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCertificationStatus(new AbortController().signal)).rejects.toThrow(
      `Certification status route returned HTTP 404: ${CERTIFICATION_STATUS_STATIC_ROUTE}`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
