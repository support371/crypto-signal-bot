/**
 * operatorAuth.ts
 *
 * Operator authentication helpers — session-scoped only.
 *
 * SECURITY: API keys are NEVER stored in localStorage, sessionStorage,
 * or any browser-persistent storage. Keys must stay server-side in
 * platform secret managers or Action authentication settings.
 *
 * The frontend must never store, expose, or proxy operator secrets.
 */

export const OPERATOR_API_KEY_STORAGE_KEY = 'crypto-signal-bot:operator-api-key:v1';

/**
 * Read operator API key — returns empty string.
 * Browser key storage has been removed for security.
 * Backend/API authorization must be enforced server-side.
 */
export function readOperatorApiKey(): string {
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
 * Clear operator API key — no-op because nothing is stored client-side.
 */
export function clearOperatorApiKey(): void {
  // Nothing stored — nothing to clear.
}
