/**
 * Backend auth compatibility shim.
 *
 * SECURITY: Do not read backend API keys from localStorage or any other
 * browser-persistent storage. Vite client bundles are public, and browser
 * storage is not a safe place for server/operator credentials.
 *
 * Kept as a compatibility export for any older imports.
 */
export function getStoredBackendApiKey(): string {
  return '';
}
