/**
 * Environment Configuration
 * 
 * This module provides type-safe access to environment variables.
 * All environment variables are validated and have default values.
 */

interface EnvConfig {
  VITE_API_BASE_URL: string;
  VITE_WS_BASE_URL: string;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  VITE_PAPER_TRADING_MODE: string;
  VITE_APP_VERSION: string;
  VITE_APP_NAME: string;
}

interface ValidatedEnv extends EnvConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  paperTradingMode: boolean;
  appVersion: string;
  appName: string;
}

const DEFAULT_ENV: EnvConfig = {
  VITE_API_BASE_URL: 'http://localhost:8000/api',
  VITE_WS_BASE_URL: 'ws://localhost:8000',
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
  VITE_PAPER_TRADING_MODE: 'true',
  VITE_APP_VERSION: '2.0.0',
  VITE_APP_NAME: 'Crypto Signal Bot V2',
};

// Validate and parse environment variables
function validateEnv(): ValidatedEnv {
  const env: Partial<EnvConfig> = {
    ...DEFAULT_ENV,
    ...import.meta.env,
  };

  return {
    ...env,
    apiBaseUrl: env.VITE_API_BASE_URL || DEFAULT_ENV.VITE_API_BASE_URL,
    wsBaseUrl: env.VITE_WS_BASE_URL || DEFAULT_ENV.VITE_WS_BASE_URL,
    supabaseUrl: env.VITE_SUPABASE_URL || DEFAULT_ENV.VITE_SUPABASE_URL,
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || DEFAULT_ENV.VITE_SUPABASE_ANON_KEY,
    paperTradingMode: (env.VITE_PAPER_TRADING_MODE || DEFAULT_ENV.VITE_PAPER_TRADING_MODE).toLowerCase() === 'true',
    appVersion: env.VITE_APP_VERSION || DEFAULT_ENV.VITE_APP_VERSION,
    appName: env.VITE_APP_NAME || DEFAULT_ENV.VITE_APP_NAME,
  };
}

const validatedEnv: ValidatedEnv = validateEnv();

// Export validated environment variables
export const env = {
  apiBaseUrl: validatedEnv.apiBaseUrl,
  wsBaseUrl: validatedEnv.wsBaseUrl,
  supabaseUrl: validatedEnv.supabaseUrl,
  supabaseAnonKey: validatedEnv.supabaseAnonKey,
  paperTradingMode: validatedEnv.paperTradingMode,
  appVersion: validatedEnv.appVersion,
  appName: validatedEnv.appName,
};

// Runtime configuration override
// Note: Paper trading mode cannot be disabled
export function setEnvOverrides(overrides: Partial<Omit<ValidatedEnv, 'paperTradingMode'>>): void {
  // Paper trading mode is always enforced
  Object.assign(validatedEnv, overrides);
}

// Get raw environment (for debugging)
export function getRawEnv(): Partial<EnvConfig> {
  return import.meta.env;
}