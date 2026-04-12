import React, { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { AuthContext } from '@/contexts/AuthContextStore';
import { getSupabaseClient } from '@/integrations/supabase/client';
import { SUPABASE_CONFIGURED } from '@/integrations/supabase/config';

// Minimal synthetic user for local (no-Supabase) mode.
const LOCAL_USER = { id: 'local', email: 'local@localhost' } as User;
const LOCAL_SESSION = { user: LOCAL_USER, access_token: 'local' } as unknown as Session;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(SUPABASE_CONFIGURED ? null : LOCAL_USER);
  const [session, setSession] = useState<Session | null>(SUPABASE_CONFIGURED ? null : LOCAL_SESSION);
  const [isLoading, setIsLoading] = useState(SUPABASE_CONFIGURED);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return; // local mode — already have a synthetic session

    let unsubscribed = false;
    let cleanup = () => {};

    void (async () => {
      try {
        const supabase = await getSupabaseClient();
        if (unsubscribed) return;

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          setSession(nextSession);
          setUser(nextSession?.user ?? null);
          setIsLoading(false);
        });
        cleanup = () => subscription.unsubscribe();

        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!unsubscribed) {
          setSession(currentSession);
          setUser(currentSession?.user ?? null);
          setIsLoading(false);
        }
      } catch {
        if (!unsubscribed) {
          setSession(null);
          setUser(null);
          setIsLoading(false);
        }
      }
    })();

    return () => {
      unsubscribed = true;
      cleanup();
    };
  }, []);

  const signUp = async (email: string, password: string) => {
    if (!SUPABASE_CONFIGURED) return { error: new Error('Supabase not configured') };
    const redirectUrl = `${window.location.origin}/`;
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl } });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    if (!SUPABASE_CONFIGURED) return { error: new Error('Supabase not configured') };
    const supabase = await getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    if (!SUPABASE_CONFIGURED) return;
    const supabase = await getSupabaseClient();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
