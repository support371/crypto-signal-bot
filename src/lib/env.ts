const env = import.meta.env;

const LOCAL_BACKEND_URL = 'http://localhost:8000';
const HOSTED_BACKEND_URL = 'https://crypto-signal-bot-api.gr8r9bfzry.workers.dev';

export type FrontendEnvValidation = {
  backendUrl: string;
  isLocalBackend: boolean;
  isProductionBuild: boolean;
  hasSupabaseUrl: boolean;
  hasSupabaseKey: boolean;
  isDemoMode: boolean;
  missingRequired: string[];
  warnings: string[];
};

export const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export function getConfiguredBackendUrl() {
  const explicitUrl =
    env.VITE_BACKEND_URL ||
    env.VITE_BACKEND_BASE_URL ||
    env.VITE_CRYPTOCORE_API_BASE ||
    env.VITE_API_URL ||
    env.NEXT_PUBLIC_BACKEND_URL;

  if (!env.PROD && explicitUrl && /^https?:\/\//i.test(explicitUrl)) {
    return '/api';
  }

  if (env.PROD && explicitUrl && !/^https?:\/\//i.test(explicitUrl)) {
    console.warn(`[env] Ignoring relative production backend URL "${explicitUrl}". Using hosted Cloudflare Worker backend instead.`);
    return HOSTED_BACKEND_URL;
  }

  return trimTrailingSlash(explicitUrl || (env.PROD ? HOSTED_BACKEND_URL : LOCAL_BACKEND_URL));
}

export function getSupabasePublishableKey() {
  return env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

export function getSupabaseUrl() {
  return env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
}

export function isDemoModeEnabled() {
  const demoMode = env.VITE_DEMO_MODE;
  if (demoMode === 'false' || demoMode === '0') return false;
  if (demoMode === 'true' || demoMode === '1') return true;
  return Boolean(env.PROD);
}

export function validateFrontendEnv(): FrontendEnvValidation {
  const backendUrl = getConfiguredBackendUrl();
  const isProductionBuild = env.PROD;
  const isLocalBackend = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(backendUrl);
  const hasSupabaseUrl = Boolean(getSupabaseUrl());
  const hasSupabaseKey = Boolean(getSupabasePublishableKey());
  const isDemoMode = isDemoModeEnabled();
  const warnings: string[] = [];
  const missingRequired: string[] = [];

  if (isProductionBuild && isLocalBackend) {
    missingRequired.push('VITE_BACKEND_URL or VITE_CRYPTOCORE_API_BASE');
    warnings.push('Backend URL is unset or points to localhost in a production build. Set VITE_BACKEND_URL or VITE_CRYPTOCORE_API_BASE to the HTTPS backend origin.');
  }

  if (isProductionBuild && backendUrl.startsWith('http://') && !isLocalBackend) {
    warnings.push('Backend URL uses plain HTTP in production. Use HTTPS before release.');
  }

  if (hasSupabaseUrl !== hasSupabaseKey) {
    if (!hasSupabaseUrl) missingRequired.push('VITE_SUPABASE_URL');
    if (!hasSupabaseKey) missingRequired.push('VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY');
    warnings.push('Supabase frontend auth is partially configured. Set both URL and publishable key, or leave both empty for local paper mode.');
  }

  if (isProductionBuild && isDemoMode && !hasSupabaseUrl) {
    warnings.push('Demo mode is enabled without Supabase auth. This is intended for paper/demo releases only. Live trading is disabled.');
  }

  return {
    backendUrl,
    isLocalBackend,
    isProductionBuild,
    hasSupabaseUrl,
    hasSupabaseKey,
    isDemoMode,
    missingRequired: Array.from(new Set(missingRequired)),
    warnings,
  };
}

export function shouldRenderSetupRequired(validation = validateFrontendEnv()) {
  return validation.isProductionBuild && validation.missingRequired.length > 0;
}

export function logFrontendEnvWarnings() {
  const validation = validateFrontendEnv();
  for (const warning of validation.warnings) {
    console.warn(`[env] ${warning}`);
  }
  return validation;
}
