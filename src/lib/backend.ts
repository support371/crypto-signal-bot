import { getStoredBackendApiKey } from '@/lib/backendAuth';

const env = import.meta.env as Record<string, string | undefined>;

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

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
  const explicitUrl = env.VITE_BACKEND_URL || env.VITE_BACKEND_BASE_URL;
  return trimTrailingSlash(explicitUrl || DEFAULT_BACKEND_URL);
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
