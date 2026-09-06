import { createContext, useContext } from "react";
import { SUPABASE_CONFIGURED } from "@/integrations/supabase/config";

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  user: AuthUser;
  access_token: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  session: AuthSession | null;
  isLoading: boolean;
  authUnconfigured: boolean;
  isDemoMode: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ error: Error | null }>;
  updatePassword: (password: string) => Promise<{ error: Error | null }>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Canonical authentication availability flag.
 * Keep this sourced from the shared Supabase configuration module so production
 * fallback configuration and hosting-environment overrides cannot drift apart.
 */
export const isSupabaseConfigured = SUPABASE_CONFIGURED;

/**
 * Load the Supabase SDK only when an auth operation is actually needed. This keeps
 * the public trading-terminal entry bundle within its production performance budget.
 */
export async function getSupabaseClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_PUBLISHABLE_KEY as Vercel environment variables."
    );
  }
  const { getSupabaseClient: getConfiguredSupabaseClient } = await import(
    "@/integrations/supabase/client"
  );
  return getConfiguredSupabaseClient();
}
