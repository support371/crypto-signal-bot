/**
 * src/lib/apiClient.ts
 *
 * Unified backend API client — single source of truth for all HTTP calls.
 * Replaces the overlapping logic in api.ts + backend.ts.
 * Both legacy modules re-export from here for backwards compatibility.
 */
import { getConfiguredBackendUrl, trimTrailingSlash } from "@/lib/env";
import { readOperatorApiKey } from "@/lib/operatorAuth";

// ── URL helpers ─────────────────────────────────────────────────────────────

export function getBackendBaseUrl(): string {
  return getConfiguredBackendUrl();
}

export function getBackendWebSocketUrl(path = "/ws"): string {
  const explicitWsUrl =
    (typeof import.meta !== "undefined" && import.meta.env?.VITE_WS_URL) || "";
  if (explicitWsUrl) return explicitWsUrl;

  const base = getBackendBaseUrl();
  if (typeof window === "undefined") {
    return `${base.replace(/^http/i, "ws")}${path}`;
  }

  const resolved = new URL(base, window.location.origin);
  const normalizedPath = trimTrailingSlash(resolved.pathname);
  const wsPath = normalizedPath.endsWith("/api")
    ? `${normalizedPath.slice(0, -4) || ""}${path}`
    : `${normalizedPath}${path}`;

  resolved.protocol = resolved.protocol === "https:" ? "wss:" : "ws:";
  resolved.pathname = wsPath.replace(/\/{2,}/g, "/");
  resolved.search = "";
  resolved.hash = "";
  return resolved.toString();
}

// ── Request helpers ─────────────────────────────────────────────────────────

function buildHeaders(
  initHeaders?: HeadersInit,
  includeJson = true
): Headers {
  const headers = new Headers(initHeaders ?? {});
  if (includeJson && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const key = readOperatorApiKey();
  if (key && !headers.has("X-API-Key")) headers.set("X-API-Key", key);
  return headers;
}

async function readError(response: Response): Promise<string> {
  const fallback = `Backend request failed (${response.status})`;
  try {
    const body = await response.json();
    return body?.detail || body?.message || fallback;
  } catch {
    try {
      return (await response.text()) || fallback;
    } catch {
      return fallback;
    }
  }
}

// ── Core fetch ──────────────────────────────────────────────────────────────

export async function apiRequest<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const url = `${getBackendBaseUrl()}${path}`;
  const { headers: initHeaders, ...rest } = init;
  const isJson =
    !initHeaders ||
    !(initHeaders instanceof Headers && initHeaders.has("Content-Type"));

  const response = await fetch(url, {
    ...rest,
    headers: buildHeaders(initHeaders as HeadersInit | undefined, isJson),
  });

  if (!response.ok) {
    const msg = await readError(response);
    throw new Error(msg);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return undefined as T;
  return response.json() as Promise<T>;
}

/** GET shorthand */
export function apiGet<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "GET" });
}

/** POST shorthand */
export function apiPost<T = unknown>(
  path: string,
  body?: unknown
): Promise<T> {
  return apiRequest<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
