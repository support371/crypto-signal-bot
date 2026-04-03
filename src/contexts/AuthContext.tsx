import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, SUPABASE_CONFIGURED } from '@/integrations/supabase/client';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// Minimal synthetic user for local (no-Supabase) mode.
const LOCAL_USER = { id: 'local', email: 'local@localhost' } as User;
const LOCAL_SESSION = { user: LOCAL_USER, access_token: 'local' } as unknown as Session;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(SUPABASE_CONFIGURED ? null : LOCAL_USER);
  const [session, setSession] = useState<Session | null>(SUPABASE_CONFIGURED ? null : LOCAL_SESSION);
  const [isLoading, setIsLoading] = useState(SUPABASE_CONFIGURED);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED) return; // local mode — already have a synthetic session

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    if (!SUPABASE_CONFIGURED) return { error: new Error('Supabase not configured') };
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectUrl } });
    return { error: error as Error | null };
  };

  const signIn = async (email: string, password: string) => {
    if (!SUPABASE_CONFIGURED) return { error: new Error('Supabase not configured') };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    if (!SUPABASE_CONFIGURED) return;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, isLoading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
