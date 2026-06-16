/**
 * src/lib/api.ts
 *
 * Central backend API client.
 *
 * RULE: This module is the single gateway between the frontend and the backend.
 * It does not fabricate data when the backend is unreachable — it throws.
 * Callers are responsible for catching and showing unavailable states.
 */

import { getConfiguredBackendUrl } from '@/lib/env';

let _cachedBackendUrl: string | null = null;

export function getBackendUrl(): string {
  if (_cachedBackendUrl) return _cachedBackendUrl;
  _cachedBackendUrl = getConfiguredBackendUrl();
  return _cachedBackendUrl;
}

export function getWebSocketUrl(): string {
  const base = getBackendUrl();
  const u = new URL(base, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  const cleaned = u.pathname.replace(/\/+$/, '').replace(/\/api$/, '');
  u.pathname = `${cleaned}/ws/updates`.replace(/\/{2,}/g, '/');
  u.search = '';
  u.hash = '';
  return u.toString();
}

export class BackendConfigError extends Error {
  readonly type = 'BACKEND_CONFIG_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BackendConfigError';
  }
}

export class BackendUnavailableError extends Error {
  readonly type = 'BACKEND_UNAVAILABLE' as const;
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'BackendUnavailableError';
    this.status = status;
  }
}

export class BackendAuthError extends Error {
  readonly type = 'BACKEND_AUTH_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BackendAuthError';
  }
}

export function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    error instanceof BackendAuthError ||
    msg.includes('401') ||
    msg.includes('Invalid token') ||
    msg.includes('Invalid JWT') ||
    msg.includes('Unauthorized')
  );
}

let _onAuthError: (() => void) | null = null;
export function registerAuthErrorCallback(cb: (() => void) | null): void {
  _onAuthError = cb;
}

function notifyAuthError(error: unknown): boolean {
  if (isAuthError(error)) {
    _onAuthError?.();
    return true;
  }
  return false;
}

function buildHeaders(existing?: HeadersInit, includeContentType = false): Headers {
  const headers = new Headers(existing ?? {});
  if (includeContentType && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return headers;
}

async function extractErrorMessage(response: Response): Promise<string> {
  const fallback = `Backend error (${response.status})`;
  try {
    const body = await response.json();
    return body?.detail ?? body?.message ?? body?.error ?? fallback;
  } catch {
    try {
      return (await response.text()) || fallback;
    } catch {
      return fallback;
    }
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${getBackendUrl()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: buildHeaders(options.headers, !!options.body),
  });

  if (!response.ok) {
    const message = await extractErrorMessage(response);
    if (response.status === 401 || response.status === 403) {
      const err = new BackendAuthError(message);
      notifyAuthError(err);
      throw err;
    }
    throw new BackendUnavailableError(message, response.status);
  }

  return response.json() as Promise<T>;
}

export async function apiText(
  path: string,
  options: RequestInit = {},
): Promise<string> {
  const url = `${getBackendUrl()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: buildHeaders(options.headers, false),
  });
  if (!response.ok) {
    const message = await extractErrorMessage(response);
    throw new BackendUnavailableError(message, response.status);
  }
  return response.text();
}
