export const SETTINGS_STORAGE_KEY = 'crypto-signal-bot:settings:v1';
export const OPERATOR_API_KEY_STORAGE_KEY = 'crypto-signal-bot:operator-api-key:v1';

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readSettingsOperatorKey(storage: Storage): string {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return '';

    const parsed = JSON.parse(raw) as { operatorApiKey?: unknown };
    return typeof parsed.operatorApiKey === 'string'
      ? parsed.operatorApiKey.trim()
      : '';
  } catch {
    return '';
  }
}

export function readOperatorApiKey(): string {
  const storage = safeLocalStorage();
  if (!storage) return '';

  const dedicatedKey = storage.getItem(OPERATOR_API_KEY_STORAGE_KEY)?.trim() ?? '';
  if (dedicatedKey) return dedicatedKey;

  return readSettingsOperatorKey(storage);
}

export function writeOperatorApiKey(value: string): void {
  const storage = safeLocalStorage();
  if (!storage) return;

  const trimmed = value.trim();
  try {
    if (trimmed) {
      storage.setItem(OPERATOR_API_KEY_STORAGE_KEY, trimmed);
    } else {
      storage.removeItem(OPERATOR_API_KEY_STORAGE_KEY);
    }
  } catch {
    // storage unavailable — no-op
  }
}

export function hasOperatorApiKey(): boolean {
  return readOperatorApiKey().length > 0;
}
