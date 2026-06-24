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

function toWebSocketBase(value: string): string {
  if (value.startsWith('https://')) return `wss://${value.slice('https://'.length)}`;
  if (value.startsWith('http://')) return `ws://${value.slice('http://'.length)}`;
  return value;
}

export function isDemoModeEnabled(): boolean {
  return readString('VITE_DEMO_MODE')?.toLowerCase() === 'true';
}

export function getConfiguredBackendUrl(): string {
  const configured = readString(
    'VITE_BACKEND_URL',
    'VITE_CRYPTOCORE_API_BASE',
    'VITE_API_BASE_URL',
  );

  if (configured) return trimTrailingSlash(configured);
  if (import.meta.env.DEV) return 'http://localhost:8000';

  throw new Error(
    'Backend URL is not configured. Set VITE_BACKEND_URL to the public paper-mode Worker URL.',
  );
}

export function getConfiguredWebSocketUrl(): string {
  const configured = readString('VITE_WS_URL', 'VITE_WS_BASE_URL');
  if (configured) return trimTrailingSlash(configured);
  return toWebSocketBase(getConfiguredBackendUrl());
}

export function validateFrontendEnv(): FrontendEnvValidation {
  const missingRequired: string[] = [];
  const warnings: string[] = [];
  const demoMode = isDemoModeEnabled();
  const backendUrl = readString(
    'VITE_BACKEND_URL',
    'VITE_CRYPTOCORE_API_BASE',
    'VITE_API_BASE_URL',
  );
  const supabaseUrl = readString('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  const supabaseKey = readString(
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  );

  if (!backendUrl) missingRequired.push('VITE_BACKEND_URL');
  if (!demoMode && !supabaseUrl) missingRequired.push('VITE_SUPABASE_URL');
  if (!demoMode && !supabaseKey) {
    missingRequired.push('VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY');
  }

  if (readString('VITE_API_BASE_URL') && !readString('VITE_BACKEND_URL')) {
    warnings.push('VITE_API_BASE_URL is a legacy alias; migrate to VITE_BACKEND_URL.');
  }
  if (backendUrl && import.meta.env.PROD && !backendUrl.startsWith('https://')) {
    warnings.push('The production backend URL should use HTTPS.');
  }
  if (demoMode) {
    warnings.push('Demo mode is active. Live trading and withdrawals remain unavailable.');
  }

  return {
    ok: missingRequired.length === 0,
    missingRequired,
    warnings,
    backendUrl: backendUrl ? trimTrailingSlash(backendUrl) : null,
    supabaseConfigured: Boolean(supabaseUrl && supabaseKey),
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
  supabaseUrl: readString('VITE_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL') ?? '',
  supabaseAnonKey:
    readString(
      'VITE_SUPABASE_PUBLISHABLE_KEY',
      'VITE_SUPABASE_ANON_KEY',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ) ?? '',
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
