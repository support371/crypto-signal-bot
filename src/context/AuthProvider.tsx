/**
 * src/context/AuthProvider.tsx
 *
 * PHASE 3 — Real authentication. No hardcoded local user.
 *
 * REMOVED (phase 3):
 *   - const H = { id: "local", email: "local@localhost" }  (finding F3)
 *   - const Oe = { user: H, access_token: "local" }        (finding F3)
 *   - useState(isSupabaseConfigured ? null : H)            (finding F3)
 *   - The entire "if not configured, inject fake session" branch  (finding F3)
 *
 * REPLACED WITH:
 *   - When Supabase is not configured: user = null, session = null.
 *     The ProtectedRoute redirects to /auth, which shows a clear error.
 *   - When Supabase IS configured: real auth lifecycle as before.
 *
 * NOTE: VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set
 *       as Vercel environment variables for authentication to work.
 *       The app will not bypass auth when they are absent.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Supabase config check — no fabricated session when absent
// ---------------------------------------------------------------------------

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

// Lazy Supabase client — only created when configured
let _supabaseClient: import("@supabase/supabase-js").SupabaseClient | null = null;

async function getSupabaseClient() {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and " +
      "VITE_SUPABASE_PUBLISHABLE_KEY as Vercel environment variables."
    );
  }
  if (!_supabaseClient) {
    const { createClient } = await import("@supabase/supabase-js");
    _supabaseClient = createClient(SUPABASE_URL!, SUPABASE_KEY!);
  }
  return _supabaseClient;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthSession {
  user: AuthUser;
  access_token: string;
}

export interface AuthContextValue {
  user:      AuthUser | null;
  session:   AuthSession | null;
  isLoading: boolean;
  /**
   * True when auth is required but Supabase is not configured.
   * UI should show a clear "configure Supabase" error, not a fake login.
   */
  authUnconfigured: boolean;
  signUp:   (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn:   (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut:  () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,      setUser]      = useState<AuthUser | null>(null);
  const [session,   setSession]   = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured); // false when not configured

  // When Supabase is configured, subscribe to auth state
  useEffect(() => {
    if (!isSupabaseConfigured) {
      // PHASE 3: no hardcoded local user injected here.
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
  }, []);

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
        authUnconfigured: !isSupabaseConfigured,
        signUp,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
