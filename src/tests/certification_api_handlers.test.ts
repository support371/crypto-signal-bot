import { afterEach, describe, expect, it, vi } from 'vitest';
import certificationBackendHealthHandler from '../../api/certification/backend-health.js';
import certificationStatusHandler from '../../api/certification/status.js';

type TestRequest = {
  method?: string;
};

class TestResponse {
  statusCode = 200;
  body: string | undefined;
  readonly headers = new Map<string, string>();

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value));
    return this;
  }

  end(body?: string) {
    this.body = body;
    return this;
  }

  header(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  json(): Record<string, unknown> {
    expect(this.body).toBeTypeOf('string');
    return JSON.parse(this.body as string) as Record<string, unknown>;
  }
}

const ENV_KEYS = [
  'VERCEL_GIT_COMMIT_SHA',
  'VERCEL_ENV',
  'CERTIFICATION_BACKEND_URL',
  'VITE_BACKEND_URL',
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as Record<
  (typeof ENV_KEYS)[number],
  string | undefined
>;

function restoreEnvironment() {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  restoreEnvironment();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('certification status handler', () => {
  it('returns minimized preview metadata with every operational capability locked', () => {
    process.env.VERCEL_GIT_COMMIT_SHA = '1234567890abcdef1234567890abcdef12345678';
    process.env.VERCEL_ENV = 'preview';

    const response = new TestResponse();
    certificationStatusHandler({ method: 'GET' } as TestRequest, response);

    expect(response.statusCode).toBe(200);
    expect(response.header('cache-control')).toBe('no-store');
    expect(response.header('x-certification-mirror')).toBe('read-only');

    const payload = response.json();
    expect(payload.schemaVersion).toBe('certification-status.v1');
    expect(payload.mode).toBe('CERTIFICATION');
    expect(payload.readOnly).toBe(true);
    expect(payload.release).toMatchObject({
      packageVersion: '0.0.0',
      channel: 'preview-candidate',
      commit: '1234567890ab',
      environment: 'preview',
    });

    const capabilities = payload.capabilities as Record<string, unknown>;
    expect(Object.keys(capabilities)).toHaveLength(7);
    expect(Object.values(capabilities).every((value) => value === false)).toBe(true);
  });

  it('suppresses the body for HEAD requests', () => {
    const response = new TestResponse();
    certificationStatusHandler({ method: 'HEAD' } as TestRequest, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeUndefined();
    expect(response.header('x-certification-mirror')).toBe('read-only');
  });

  it('rejects write methods and advertises the read-only method set', () => {
    const response = new TestResponse();
    certificationStatusHandler({ method: 'POST' } as TestRequest, response);

    expect(response.statusCode).toBe(405);
    expect(response.header('allow')).toBe('GET, HEAD, OPTIONS');
    expect(response.json()).toMatchObject({
      code: 'CERTIFICATION_STATUS_READ_ONLY',
      readOnly: true,
    });
  });
});

describe('certification backend-health handler', () => {
  it('rejects targets outside the workers.dev HTTPS policy without making a request', async () => {
    process.env.CERTIFICATION_BACKEND_URL = 'https://example.com/private/path?token=discarded';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = new TestResponse();
    await certificationBackendHealthHandler({ method: 'GET' } as TestRequest, response);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schemaVersion: 'certification-backend-health.v1',
      readOnly: true,
      target: {
        configured: false,
        source: 'CERTIFICATION_BACKEND_URL',
        host: 'unavailable',
      },
      result: {
        state: 'target-policy-rejected',
        reachable: false,
        healthy: false,
        statusCode: null,
      },
      responseBodyRead: false,
      retriesAttempted: 0,
    });
  });

  it('performs exactly one normalized health request and reports success without reading a body', async () => {
    process.env.CERTIFICATION_BACKEND_URL = 'https://sample.workers.dev/ignored/path?query=removed#fragment';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const response = new TestResponse();
    await certificationBackendHealthHandler({ method: 'GET' } as TestRequest, response);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(target.toString()).toBe('https://sample.workers.dev/health');
    expect(init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
    });
    expect(init).not.toHaveProperty('credentials');

    expect(response.statusCode).toBe(200);
    expect(response.header('x-certification-diagnostic')).toBe('read-only');
    expect(response.json()).toMatchObject({
      target: {
        configured: true,
        source: 'CERTIFICATION_BACKEND_URL',
        host: 'sample.workers.dev',
      },
      result: {
        state: 'healthy',
        reachable: true,
        healthy: true,
        statusCode: 200,
      },
      responseBodyRead: false,
      retriesAttempted: 0,
    });
  });

  it('reports an unreachable target after one failed request and does not retry', async () => {
    process.env.CERTIFICATION_BACKEND_URL = 'https://sample.workers.dev';
    const fetchMock = vi.fn().mockRejectedValue(new Error('network unavailable'));
    vi.stubGlobal('fetch', fetchMock);

    const response = new TestResponse();
    await certificationBackendHealthHandler({ method: 'GET' } as TestRequest, response);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      result: {
        state: 'unreachable',
        reachable: false,
        healthy: false,
        statusCode: null,
      },
      responseBodyRead: false,
      retriesAttempted: 0,
    });
  });

  it('rejects write methods without contacting the configured target', async () => {
    process.env.CERTIFICATION_BACKEND_URL = 'https://sample.workers.dev';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = new TestResponse();
    await certificationBackendHealthHandler({ method: 'POST' } as TestRequest, response);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(405);
    expect(response.header('allow')).toBe('GET, HEAD, OPTIONS');
    expect(response.json()).toMatchObject({
      code: 'BACKEND_HEALTH_DIAGNOSTIC_READ_ONLY',
      readOnly: true,
    });
  });
});
