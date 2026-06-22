import { getConfiguredBackendUrl, getConfiguredWebSocketUrl } from './env';

const DEFAULT_TIMEOUT_MS = 10_000;
const BROWSER_BLOCKED_PATH = /\/(?:intent\/live|withdraw(?:al)?s?|mainnet)(?:\/|$)/i;

type BackendRequestInit = RequestInit & {
  timeoutMs?: number;
};

export class FrontendBackendError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FrontendBackendError';
    this.status = status;
  }
}

export function getBackendBaseUrl(): string {
  return getConfiguredBackendUrl();
}

export function getBackendWebSocketUrl(path = '/ws/updates'): string {
  const base = getConfiguredWebSocketUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/+$/, '')}${normalizedPath}`;
}

function buildBackendUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getBackendBaseUrl().replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function assertBrowserSafe(path: string, method: string): void {
  if (BROWSER_BLOCKED_PATH.test(path)) {
    throw new FrontendBackendError(
      `Browser access to ${path} is blocked. Live trading, mainnet, and withdrawals are server-only and disabled.`,
      403,
    );
  }

  if (method !== 'GET' && method !== 'HEAD' && /\/guardian\/reset/i.test(path)) {
    throw new FrontendBackendError(
      'Guardian reset cannot be initiated from the public frontend.',
      403,
    );
  }
}

async function readError(response: Response): Promise<string> {
  const fallback = `Backend request failed (${response.status})`;
  const contentType = response.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('application/json')) {
      const payload = (await response.json()) as Record<string, unknown>;
      const message = payload.detail ?? payload.message ?? payload.error;
      return typeof message === 'string' ? message : fallback;
    }
    return (await response.text()) || fallback;
  } catch {
    return fallback;
  }
}

async function backendFetch(path: string, init: BackendRequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  assertBrowserSafe(path, method);

  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const headers = new Headers(init.headers ?? {});
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(buildBackendUrl(path), {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
      credentials: 'omit',
    });

    if (!response.ok) {
      throw new FrontendBackendError(await readError(response), response.status);
    }

    return response;
  } catch (error) {
    if (error instanceof FrontendBackendError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new FrontendBackendError(`Backend request timed out: ${path}`);
    }
    throw new FrontendBackendError(
      error instanceof Error ? error.message : `Backend request failed: ${path}`,
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchBackendJson<T>(
  path: string,
  init: BackendRequestInit = {},
): Promise<T> {
  const response = await backendFetch(path, init);
  return (await response.json()) as T;
}

export async function fetchBackendText(
  path: string,
  init: BackendRequestInit = {},
): Promise<string> {
  const response = await backendFetch(path, init);
  return response.text();
}
