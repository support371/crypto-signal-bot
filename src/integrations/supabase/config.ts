// Support both VITE_ prefixed vars and NEXT_PUBLIC_ vars (Vercel integration)
const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL
) as string | undefined;

const SUPABASE_PUBLISHABLE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
) as string | undefined;

export { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL };

export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
