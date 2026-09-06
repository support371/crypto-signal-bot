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

const DEMO_USER: AuthUser = { id: 'demo-paper-user', email: 'demo@paper.local' };
const DEMO_SESSION: AuthSession = { user: DEMO_USER, access_token: 'demo-paper-token' };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const demoModeEnabled = isDemoModeEnabled();
  const shouldUseDemoMode = demoModeEnabled && !isSupabaseConfigured;

  const [user, setUser] = useState<AuthUser | null>(shouldUseDemoMode ? DEMO_USER : null);
  const [session, setSession] = useState<AuthSession | null>(shouldUseDemoMode ? DEMO_SESSION : null);
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (shouldUseDemoMode) {
      setUser(DEMO_USER);
      setSession(DEMO_SESSION);
      setIsLoading(false);
      return;
    }

    if (!isSupabaseConfigured) {
      setUser(null);
      setSession(null);
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
            if (cancelled) return;
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

  const signUp = useCallback(
    async (email: string, password: string): Promise<{ error: Error | null }> => {
      if (!isSupabaseConfigured) {
        return { error: new Error("Supabase is not configured on this deployment.") };
      }
      const client = await getSupabaseClient();
      const redirectTo = `${window.location.origin}/auth`;
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
    if (shouldUseDemoMode || !isSupabaseConfigured) {
      setUser(null);
      setSession(null);
      return;
    }
    const client = await getSupabaseClient();
    await client.auth.signOut();
    setUser(null);
    setSession(null);
  }, [shouldUseDemoMode]);

  const requestPasswordReset = useCallback(
    async (email: string): Promise<{ error: Error | null }> => {
      if (!isSupabaseConfigured) {
        return { error: new Error("Supabase is not configured on this deployment.") };
      }
      const client = await getSupabaseClient();
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error: error as Error | null };
    },
    []
  );

  const updatePassword = useCallback(
    async (password: string): Promise<{ error: Error | null }> => {
      if (!isSupabaseConfigured) {
        return { error: new Error("Supabase is not configured on this deployment.") };
      }
      const client = await getSupabaseClient();
      const { error } = await client.auth.updateUser({ password });
      return { error: error as Error | null };
    },
    []
  );

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
        requestPasswordReset,
        updatePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
