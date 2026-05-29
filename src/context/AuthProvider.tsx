/**
 * src/context/AuthProvider.tsx
 *
 * PHASE 3 — Real authentication. No hardcoded local user.
 *
 * Context, types, hooks, and Supabase config check live in AuthContext.ts
 * to satisfy react-refresh (only components exported from .tsx files).
 *
 * DEMO MODE (Option B):
 *   - When VITE_DEMO_MODE=true AND Supabase is not configured:
 *     - A demo user is injected for paper/demo dashboard access.
 *     - isDemoMode flag is exposed to show demo banner.
 *     - Live trading is never allowed in demo mode.
 *
 * NOTE: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set
 *       as Vercel environment variables for production authentication.
 */

import React, { useCallback, useEffect, useState } from "react";
import { isDemoModeEnabled } from "@/lib/env";
import {
  AuthContext,
  isSupabaseConfigured,
  getSupabaseClient,
  type AuthUser,
  type AuthSession,
} from "@/context/AuthContext";

export type { AuthUser, AuthSession, AuthContextValue } from "@/context/AuthContext";

// Demo user for VITE_DEMO_MODE=true when Supabase is not configured
const DEMO_USER: AuthUser = { id: 'demo-paper-user', email: 'demo@paper.local' };
const DEMO_SESSION: AuthSession = { user: DEMO_USER, access_token: 'demo-paper-token' };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const demoModeEnabled = isDemoModeEnabled();
  const shouldUseDemoMode = demoModeEnabled && !isSupabaseConfigured;

  const [user, setUser] = useState<AuthUser | null>(shouldUseDemoMode ? DEMO_USER : null);
  const [session, setSession] = useState<AuthSession | null>(shouldUseDemoMode ? DEMO_SESSION : null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured); // false when not configured

  // When Supabase is configured, subscribe to auth state
  useEffect(() => {
    // Demo mode: user already set, no need for auth
    if (shouldUseDemoMode) {
      setIsLoading(false);
      return;
    }

    if (!isSupabaseConfigured) {
      // PHASE 3: no hardcoded local user injected here (unless demo mode).
      // user = null, session = null. ProtectedRoute handles the redirect.
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let unsubscribe = () => {};

    (async () => {
      try {
        const client = await getSupabaseClient();
        if (cancelled) return;

        const { data: { subscription } } = client.auth.onAuthStateChange(
          (_event, supabaseSession) => {
            setSession(supabaseSession as AuthSession | null);
            setUser((supabaseSession?.user ?? null) as AuthUser | null);
            setIsLoading(false);
          }
        );
        unsubscribe = () => subscription.unsubscribe();

        const { data: { session: current } } = await client.auth.getSession();
        if (!cancelled) {
          setSession(current as AuthSession | null);
          setUser((current?.user ?? null) as AuthUser | null);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setSession(null);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [shouldUseDemoMode]);

  // ---------------------------------------------------------------------------
  // Auth actions — fail with clear error when Supabase is not configured
  // ---------------------------------------------------------------------------

  const signUp = useCallback(
    async (email: string, password: string): Promise<{ error: Error | null }> => {
      if (!isSupabaseConfigured) {
        return { error: new Error("Supabase is not configured on this deployment.") };
      }
      const client = await getSupabaseClient();
      const redirectTo = `${window.location.origin}/`;
      const { error } = await client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      return { error: error as Error | null };
    },
    []
  );

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: Error | null }> => {
      if (!isSupabaseConfigured) {
        return { error: new Error("Supabase is not configured on this deployment.") };
      }
      const client = await getSupabaseClient();
      const { error } = await client.auth.signInWithPassword({ email, password });
      return { error: error as Error | null };
    },
    []
  );

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const client = await getSupabaseClient();
    await client.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        authUnconfigured: !isSupabaseConfigured && !shouldUseDemoMode,
        isDemoMode: shouldUseDemoMode,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
