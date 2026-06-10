/**
 * operatorAuth.ts
 *
 * Operator authentication helpers — session-scoped only.
 *
 * The backend API key is read from the VITE_BACKEND_API_KEY build-time
 * environment variable. It is never stored in localStorage or sessionStorage.
 * For write operations the key is also available from the in-memory operator
 * session (set via the Settings panel).
 */

const ENV_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_API_KEY) || '';

/** In-memory session key (set by Settings panel for operator actions). */
let _sessionKey = '';

/**
 * Read operator API key.
 * Prefers the in-memory session key (set via Settings); falls back to the
 * build-time VITE_BACKEND_API_KEY so public read endpoints work without login.
 */
export function readOperatorApiKey(): string {
  return _sessionKey || ENV_API_KEY;
}

/**
 * Write operator API key into the in-memory session store.
 * Kept for interface compatibility (Settings panel / operator login).
 */
export function writeOperatorApiKey(key: string): void {
  _sessionKey = key;
}

/**
 * Clear the in-memory session key.
 */
export function clearOperatorApiKey(): void {
  _sessionKey = '';
}
