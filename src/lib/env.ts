const env = import.meta.env;

const LOCAL_BACKEND_URL = 'http://localhost:8000';

export type FrontendEnvValidation = {
  backendUrl: string;
  isLocalBackend: boolean;
  isProductionBuild: boolean;
  hasSupabaseUrl: boolean;
  hasSupabaseKey: boolean;
  missingRequired: string[];
  warnings: string[];
};

export const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export function getConfiguredBackendUrl() {
  const explicitUrl = env.VITE_BACKEND_URL || env.VITE_BACKEND_BASE_URL;
  return trimTrailingSlash(explicitUrl || LOCAL_BACKEND_URL);
}

export function getSupabasePublishableKey() {
  return env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
}

export function validateFrontendEnv(): FrontendEnvValidation {
  const backendUrl = getConfiguredBackendUrl();
  const isProductionBuild = env.PROD;
  const isLocalBackend = /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(backendUrl);
  const hasSupabaseUrl = Boolean(env.VITE_SUPABASE_URL);
  const hasSupabaseKey = Boolean(getSupabasePublishableKey());
  const warnings: string[] = [];
  const missingRequired: string[] = [];

  if (isProductionBuild && isLocalBackend) {
    missingRequired.push('VITE_BACKEND_URL');
    warnings.push('VITE_BACKEND_URL is unset or points to localhost in a production build. Set it to the HTTPS backend origin.');
  }

  if (isProductionBuild && backendUrl.startsWith('http://') && !isLocalBackend) {
    warnings.push('VITE_BACKEND_URL uses plain HTTP in production. Use HTTPS before release.');
  }

  if (hasSupabaseUrl !== hasSupabaseKey) {
    if (!hasSupabaseUrl) missingRequired.push('VITE_SUPABASE_URL');
    if (!hasSupabaseKey) missingRequired.push('VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY');
    warnings.push('Supabase frontend auth is partially configured. Set both URL and publishable key, or leave both empty for local paper mode.');
  }

  return {
    backendUrl,
    isLocalBackend,
    isProductionBuild,
    hasSupabaseUrl,
    hasSupabaseKey,
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
