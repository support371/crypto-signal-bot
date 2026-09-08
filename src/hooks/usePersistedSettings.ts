import { useState, useCallback } from 'react';
import type { UserSettings } from '@/components/dashboard/SettingsModal';
import { DEFAULT_SETTINGS } from '@/components/dashboard/settingsDefaults';

const STORAGE_KEY = 'crypto-signal-bot:settings:v1';

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function sanitizeSettings(value: unknown): UserSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    riskTolerance: boundedNumber(input.riskTolerance, DEFAULT_SETTINGS.riskTolerance, 0.1, 0.9),
    volatilitySensitivity: boundedNumber(
      input.volatilitySensitivity,
      DEFAULT_SETTINGS.volatilitySensitivity,
      0.1,
      0.9,
    ),
    positionSizeFraction: boundedNumber(
      input.positionSizeFraction,
      DEFAULT_SETTINGS.positionSizeFraction,
      0.01,
      0.25,
    ),
    spreadStressThreshold: boundedNumber(
      input.spreadStressThreshold,
      DEFAULT_SETTINGS.spreadStressThreshold,
      0.001,
      0.005,
    ),
    autoTradeEnabled: booleanOr(input.autoTradeEnabled, DEFAULT_SETTINGS.autoTradeEnabled),
    soundAlertsEnabled: booleanOr(input.soundAlertsEnabled, DEFAULT_SETTINGS.soundAlertsEnabled),
  };
}

function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeSettings(settings)));
  } catch {
    // Storage unavailable — keep settings in memory only.
  }
}

function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const sanitized = sanitizeSettings(JSON.parse(raw));
    // Rewrite immediately so legacy fields such as operatorApiKey are removed.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return sanitized;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function usePersistedSettings() {
  const [settings, setSettingsState] = useState<UserSettings>(loadSettings);

  const setSettings = useCallback((next: UserSettings) => {
    const sanitized = sanitizeSettings(next);
    setSettingsState(sanitized);
    saveSettings(sanitized);
  }, []);

  return { settings, setSettings };
}