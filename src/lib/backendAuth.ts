const SETTINGS_STORAGE_KEY = 'crypto-signal-bot:settings:v1';

export function getStoredBackendApiKey(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return '';
    }

    const parsed = JSON.parse(raw) as { backendApiKey?: unknown };
    return typeof parsed.backendApiKey === 'string' ? parsed.backendApiKey.trim() : '';
  } catch {
    return '';
  }
}
