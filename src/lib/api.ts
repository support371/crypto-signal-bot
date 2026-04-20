/**
 * src/lib/api.ts
 *
 * PHASE 3 — Central backend API client.
 *
 * REMOVED (phase 3):
 *   - const Ks = "http://localhost:8000"  (hardcoded fallback, finding F1/F9)
 *   - getApiKeyFromStorage() / localStorage X-API-Key  (finding F8)
 *   - Any CoinGecko or third-party direct calls  (moved to usePrices.ts)
 *
 * RULE: This module is the single gateway between the frontend and the backend.
 *       It does not fabricate data when the backend is unreachable — it throws.
 *       Callers are responsible for catching and showing unavailable states.
 */

// ---------------------------------------------------------------------------
// Backend URL — REQUIRED. No fallback. Fail loud if missing.
// ---------------------------------------------------------------------------

let _cachedBackendUrl: string | null = null;

export function getBackendUrl(): string {
  if (_cachedBackendUrl) return _cachedBackendUrl;

  const raw = import.meta.env.VITE_BACKEND_URL as string | undefined;

  if (!raw || !raw.trim()) {
    // Surface a clear, actionable error — not a silent fallback.
    throw new BackendConfigError(
      "VITE_BACKEND_URL is not set. " +
        "Open Vercel → Project Settings → Environment Variables " +
        "and add VITE_BACKEND_URL pointing to your deployed backend, then redeploy."
    );
  }

  _cachedBackendUrl = raw.trim().replace(/\/+$/, "");
  return _cachedBackendUrl;
}

export function getWebSocketUrl(): string {
  const base = getBackendUrl();
  const u = new URL(base);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  // Normalise any /api suffix path before appending /ws/updates
  const cleaned = u.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  u.pathname = `${cleaned}/ws/updates`.replace(/\/{2,}/g, "/");
  u.search = "";
  u.hash = "";
  return u.toString();
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class BackendConfigError extends Error {
  readonly type = "BACKEND_CONFIG_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackendConfigError";
  }
}

export class BackendUnavailableError extends Error {
  readonly type = "BACKEND_UNAVAILABLE" as const;
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BackendUnavailableError";
    this.status = status;
  }
}

export class BackendAuthError extends Error {
  readonly type = "BACKEND_AUTH_ERROR" as const;
  constructor(message: string) {
    super(message);
    this.name = "BackendAuthError";
  }
}

// ---------------------------------------------------------------------------
// Auth-error detection (used by WebSocket hook to trigger banner)
// ---------------------------------------------------------------------------

export function isAuthError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    error instanceof BackendAuthError ||
    msg.includes("401") ||
    msg.includes("Invalid token") ||
    msg.includes("Invalid JWT") ||
    msg.includes("Unauthorized")
  );
}

// Session expiry callbacks — registered by AuthProvider
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

// ---------------------------------------------------------------------------
// Request headers
// NOTE: X-API-Key is no longer sourced from localStorage (Phase 3 / finding F8).
//       Operator write calls are proxied through a Vercel serverless function
//       that reads BACKEND_API_KEY from the server-side env.
//       The frontend never reads or stores the operator key.
// ---------------------------------------------------------------------------

function buildHeaders(
  existing?: HeadersInit,
  includeContentType = false
): Headers {
  const headers = new Headers(existing ?? {});
  if (includeContentType && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  // No localStorage key injection — key lives in server env only.
  return headers;
}

// ---------------------------------------------------------------------------
// Core fetch helpers
// ---------------------------------------------------------------------------

async function extractErrorMessage(response: Response): Promise<string> {
  const fallback = `Backend error (${response.status})`;
  try {
    const body = await response.json();
    return body?.detail ?? body?.message ?? fallback;
  } catch {
    try {
      return (await response.text()) || fallback;
    } catch {
      return fallback;
    }
  }
}

/**
 * apiFetch — typed JSON request to the backend.
 * Throws BackendUnavailableError (network) or BackendAuthError (401/403).
 * Never returns fabricated data.
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
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

/**
 * apiText — plain-text fetch (used for Prometheus /metrics endpoint).
 */
export async function apiText(
  path: string,
  options: RequestInit = {}
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
