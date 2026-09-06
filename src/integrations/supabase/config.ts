// Supabase publishable keys are intentionally safe for browser/public-source use.
// Environment variables remain the preferred override so the project can rotate keys
// without source changes. The production fallback binds this app to its dedicated
// Crypto Signal Bot identity project when a hosting environment omits Vite auth vars.
const PRODUCTION_SUPABASE_URL = 'https://pxcahgcoeewvkhsdvylu.supabase.co';
const PRODUCTION_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ayLhuUkQkbYtQOA9g2ZJrQ_vamyXq9G';

// Support both VITE_ prefixed vars and NEXT_PUBLIC_ vars (Vercel integration).
const SUPABASE_URL = (
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  (import.meta.env.PROD ? PRODUCTION_SUPABASE_URL : undefined)
) as string | undefined;

const SUPABASE_PUBLISHABLE_KEY = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  (import.meta.env.PROD ? PRODUCTION_SUPABASE_PUBLISHABLE_KEY : undefined)
) as string | undefined;

export { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL };

export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
