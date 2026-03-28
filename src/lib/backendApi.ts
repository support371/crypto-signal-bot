const DEFAULT_BACKEND_BASE_URL = 'http://localhost:8000';

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

export function getBackendBaseUrl() {
  return stripTrailingSlash(import.meta.env.VITE_API_BASE_URL || DEFAULT_BACKEND_BASE_URL);
}

export async function fetchBackendJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  const response = await fetch(`${getBackendBaseUrl()}${normalizedPath}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    let message = `Backend request failed with status ${response.status}`;

    try {
      const errorData = await response.json();
      if (typeof errorData?.detail === 'string') {
        message = errorData.detail;
      } else if (typeof errorData?.message === 'string') {
        message = errorData.message;
      }
    } catch {
      // Ignore non-JSON error responses and keep the generic message.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}
