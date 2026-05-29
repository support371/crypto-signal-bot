import { createContext, useContext } from "react";

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
  /**
   * True when demo mode is active (VITE_DEMO_MODE=true and Supabase not configured).
   * UI should show a demo banner and disable live trading.
   */
  isDemoMode: boolean;
  signUp:   (email: string, password: string) => Promise<{ error: Error | null }>;
  signIn:   (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut:  () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Context + hook
// ---------------------------------------------------------------------------

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Supabase config check
// ---------------------------------------------------------------------------

const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL
) as string | undefined;

const SUPABASE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
) as string | undefined;

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

// Lazy Supabase client — only created when configured
let _supabaseClient: import("@supabase/supabase-js").SupabaseClient | null = null;

export async function getSupabaseClient() {
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
