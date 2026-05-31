import { getConfiguredBackendUrl, trimTrailingSlash } from '@/lib/env';

const SETTINGS_STORAGE_KEY = 'crypto-signal-bot:settings:v1';

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

function getOperatorApiKey() {
  if (typeof window === 'undefined') return '';

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return '';

    const parsed = JSON.parse(raw) as { operatorApiKey?: unknown };
    return typeof parsed.operatorApiKey === 'string'
      ? parsed.operatorApiKey.trim()
      : '';
  } catch {
    return '';
  }
}

export function getBackendBaseUrl() {
  return getConfiguredBackendUrl();
}

export function getBackendWebSocketUrl() {
  // Allow explicit WS URL override
  const explicitWsUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) || '';
  if (explicitWsUrl) {
    return explicitWsUrl;
  }

  const backendBaseUrl = getBackendBaseUrl();

  if (typeof window === 'undefined') {
    return `${backendBaseUrl.replace(/^http/i, 'ws')}/ws`;
  }

  const resolved = new URL(backendBaseUrl, window.location.origin);
  const normalizedPath = trimTrailingSlash(resolved.pathname);
  const wsPath = normalizedPath.endsWith('/api')
    ? `${normalizedPath.slice(0, -4) || ''}/ws`
    : `${normalizedPath}/ws`;

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

  const operatorApiKey = getOperatorApiKey();
  if (operatorApiKey && !headers.has('X-API-Key')) {
    headers.set('X-API-Key', operatorApiKey);
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
