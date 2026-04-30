import { getStoredBackendApiKey } from '@/lib/backendAuth';
import { getConfiguredBackendUrl } from '@/lib/env';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

async function readErrorMessage(response: Response) {
  const fallback = `Backend request failed (${response.status})`;
  let message = fallback;

  try {
    const body = await response.json();
    message = body?.detail || body?.message || fallback;
  } catch {
    try {
      const text = await response.text();
      message = text || fallback;
    } catch {
      message = fallback;
    }
  }

  return message;
}

export function getBackendBaseUrl() {
  return getConfiguredBackendUrl();
}

export function getBackendWebSocketUrl() {
  const backendBaseUrl = getBackendBaseUrl();

  if (typeof window === 'undefined') {
    return `${backendBaseUrl.replace(/^http/i, 'ws')}/ws/updates`;
  }

  const resolved = new URL(backendBaseUrl, window.location.origin);
  const normalizedPath = resolved.pathname.replace(/\/+$/, '');
  const wsPath = normalizedPath.endsWith('/api')
    ? `${normalizedPath.slice(0, -4) || ''}/ws/updates`
    : `${normalizedPath}/ws/updates`;

  resolved.protocol = resolved.protocol === 'https:' ? 'wss:' : 'ws:';
  resolved.pathname = wsPath.replace(/\/{2,}/g, '/');
  resolved.search = '';
  resolved.hash = '';

  return resolved.toString();
}

function buildBackendHeaders(initHeaders: HeadersInit | undefined, includeJsonContentType: boolean) {
  const headers = new Headers(initHeaders ?? {});

  if (includeJsonContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const apiKey = getStoredBackendApiKey();
  if (apiKey && !headers.has('X-API-Key')) {
    headers.set('X-API-Key', apiKey);
  }

  return headers;
}

export async function fetchBackendJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...init,
    headers: buildBackendHeaders(init.headers, true),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

export async function fetchBackendText(path: string, init: RequestInit = {}): Promise<string> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...init,
    headers: buildBackendHeaders(init.headers, false),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.text();
}

export { trimTrailingSlash };
