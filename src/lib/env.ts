import {
  SUPABASE_CONFIGURED,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
} from '@/integrations/supabase/config';

export interface FrontendEnvValidation {
  ok: boolean;
  missingRequired: string[];
  warnings: string[];
  backendUrl: string | null;
  supabaseConfigured: boolean;
  demoMode: boolean;
}

export interface ValidatedEnv {
  apiBaseUrl: string;
  wsBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  paperTradingMode: true;
  demoMode: boolean;
  appVersion: string;
  appName: string;
}

type RuntimeEnv = Record<string, string | boolean | undefined>;

const runtimeEnv = import.meta.env as RuntimeEnv;

export const CURRENT_PRODUCTION_BACKEND_URL = 'https://crypto-signal-bot-api.analyzer-d94.workers.dev';
export const CURRENT_PRODUCTION_WS_URL = 'wss://crypto-signal-bot-api.analyzer-d94.workers.dev';
export const CANONICAL_PRODUCTION_HOST = 'crypto-signal-bot-indol.vercel.app';
const LEGACY_PRODUCTION_BACKEND_URLS = new Set([
  'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev',
  'https://crypto-signal-bot-api.workers.dev',
]);
const LEGACY_PRODUCTION_WS_URLS = new Set([
  'wss://crypto-signal-bot-api.gr8r9bfzry.workers.dev',
  'wss://crypto-signal-bot-api.workers.dev',
]);

function readString(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = runtimeEnv[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeBackendUrl(value: string): string {
  const normalized = trimTrailingSlash(value);
  return LEGACY_PRODUCTION_BACKEND_URLS.has(normalized)
    ? CURRENT_PRODUCTION_BACKEND_URL
    : normalized;
}

function normalizeWebSocketUrl(value: string): string {
  const normalized = trimTrailingSlash(value);
  return LEGACY_PRODUCTION_WS_URLS.has(normalized)
    ? CURRENT_PRODUCTION_WS_URL
    : normalized;
}

function toWebSocketBase(value: string): string {
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  return value;
}

export function isCanonicalProductionHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === CANONICAL_PRODUCTION_HOST;
}

export function isDemoModeEnabled(): boolean {
  const configured = readString('VITE_DEMO_MODE')?.toLowerCase() === 'true';
  return configured && !isCanonicalProductionHost();
}

export function getConfiguredBackendUrl(): string {
  const configured = readString(
    'VITE_BACKEND_URL',
    'VITE_CRYPTOCORE_API_BASE',
    'VITE_API_BASE_URL',
  );
  if (configured) return normalizeBackendUrl(configured);
  if (import.meta.env.DEV) return 'http://localhost:8000';
  throw new Error(
    'Backend URL is not configured. Set VITE_BACKEND_URL to the public Certification Mode Worker URL.',
  );
}

export function getConfiguredWebSocketUrl(): string {
  const configured = readString('VITE_WS_URL', 'VITE_WS_BASE_URL');
  if (configured) return normalizeWebSocketUrl(configured);
  return toWebSocketBase(getConfiguredBackendUrl());
}

export function validateFrontendEnv(): FrontendEnvValidation {
  const missingRequired: string[] = [];
  const warnings: string[] = [];
  const demoMode = isDemoModeEnabled();
  const configuredBackendUrl = readString(
    'VITE_BACKEND_URL',
    'VITE_CRYPTOCORE_API_BASE',
    'VITE_API_BASE_URL',
  );
  const backendUrl = configuredBackendUrl ? normalizeBackendUrl(configuredBackendUrl) : undefined;
  const configuredWsUrl = readString('VITE_WS_URL', 'VITE_WS_BASE_URL');
  const supabaseUrl = SUPABASE_URL;
  const supabaseKey = SUPABASE_PUBLISHABLE_KEY;

  if (!backendUrl) missingRequired.push('VITE_BACKEND_URL');
  if (!demoMode && !supabaseUrl) missingRequired.push('VITE_SUPABASE_URL');
  if (!demoMode && !supabaseKey) {
    missingRequired.push('VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY');
  }

  if (readString('VITE_API_BASE_URL') && !readString('VITE_BACKEND_URL')) {
    warnings.push('VITE_API_BASE_URL is a legacy alias; migrate to VITE_BACKEND_URL.');
  }
  if (configuredBackendUrl && LEGACY_PRODUCTION_BACKEND_URLS.has(trimTrailingSlash(configuredBackendUrl))) {
    warnings.push('A legacy Cloudflare Worker URL was configured and has been redirected to the current migrated Worker.');
  }
  if (configuredWsUrl && LEGACY_PRODUCTION_WS_URLS.has(trimTrailingSlash(configuredWsUrl))) {
    warnings.push('A legacy Worker WebSocket URL was configured and has been redirected to the current migrated Worker.');
  }
  if (backendUrl && import.meta.env.PROD && !backendUrl.startsWith('https://')) {
    warnings.push('The production backend URL should use HTTPS.');
  }
  if (readString('VITE_DEMO_MODE')?.toLowerCase() === 'true' && isCanonicalProductionHost()) {
    warnings.push('VITE_DEMO_MODE is configured but ignored on the canonical production domain.');
  } else if (demoMode) {
    warnings.push('Demo mode is active. Live trading and withdrawals remain unavailable.');
  }

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    warnings,
    backendUrl: backendUrl ?? null,
    supabaseConfigured: SUPABASE_CONFIGURED,
    demoMode,
  };
}

const backendUrl = (() => {
  try {
    return getConfiguredBackendUrl();
  } catch {
    return '';
  }
})();

export const env: ValidatedEnv = {
  apiBaseUrl: backendUrl,
  wsBaseUrl: backendUrl ? getConfiguredWebSocketUrl() : '',
  supabaseUrl: SUPABASE_URL ?? '',
  supabaseAnonKey: SUPABASE_PUBLISHABLE_KEY ?? '',
  paperTradingMode: true,
  demoMode: isDemoModeEnabled(),
  appVersion: readString('VITE_APP_VERSION') ?? '2.0.0',
  appName: readString('VITE_APP_NAME') ?? 'Crypto Signal Bot',
};

export function setEnvOverrides(
  overrides: Partial<Omit<ValidatedEnv, 'paperTradingMode'>>,
): void {
  Object.assign(env, overrides, { paperTradingMode: true });
}

export function getRawEnv(): RuntimeEnv {
  return runtimeEnv;
}
