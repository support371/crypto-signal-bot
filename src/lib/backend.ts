const env = import.meta.env as Record<string, string | undefined>;

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export function getBackendBaseUrl() {
  const explicitUrl = env.VITE_BACKEND_URL || env.VITE_BACKEND_BASE_URL;
  return trimTrailingSlash(explicitUrl || DEFAULT_BACKEND_URL);
}

export async function fetchBackendJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
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

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
