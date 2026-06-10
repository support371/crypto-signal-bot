/**
 * operatorAuth.ts
 *
 * Operator authentication helpers — session-scoped only.
 *
 * SECURITY: API keys are NEVER stored in localStorage, sessionStorage,
 * or any browser-persistent storage. Keys are held in React context
 * (in-memory) for the duration of the session only and cleared on page close.
 *
 * The backend API key lives in the Render environment as BACKEND_API_KEY.
 * The frontend must never store, expose, or proxy it.
 */

export const OPERATOR_API_KEY_STORAGE_KEY = 'crypto-signal-bot:operator-api-key:v1';

/**
 * Read operator API key — returns empty string.
 * localStorage key storage has been removed for security.
 * The backend enforces API key validation server-side via BACKEND_API_KEY env var.
 */
export function readOperatorApiKey(): string {
  // Key storage removed — backend manages its own API key via env var.
  // Frontend never holds, reads, or writes the operator key.
  return '';
}

/**
 * Write operator API key — no-op.
 * Kept for interface compatibility during migration.
 */
export function writeOperatorApiKey(_key: string): void {
  // Intentional no-op. Do not restore localStorage writes here.
  // See SECURITY_HARDENING.md for rationale.
}

/**
 * Clear operator API key — no-op (nothing to clear).
 */
export function clearOperatorApiKey(): void {
  // Nothing stored — nothing to clear.
}
