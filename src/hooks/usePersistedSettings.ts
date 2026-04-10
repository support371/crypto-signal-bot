import { useState, useCallback } from 'react';
import type { UserSettings } from '@/components/dashboard/SettingsModal';
import { DEFAULT_SETTINGS } from '@/components/dashboard/settingsDefaults';

const STORAGE_KEY = 'crypto-signal-bot:settings:v1';

function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as UserSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable — no-op
  }
}

export function usePersistedSettings() {
  const [settings, setSettingsState] = useState<UserSettings>(loadSettings);

  const setSettings = useCallback((next: UserSettings) => {
    setSettingsState(next);
    saveSettings(next);
  }, []);

  return { settings, setSettings };
}
