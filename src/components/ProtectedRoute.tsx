/**
 * src/components/ProtectedRoute.tsx
 *
 * PHASE 3 — No auth bypass.
 *
 * REMOVED (phase 3):
 *   - if (!isSupabaseConfigured) return <>{children}</>  (finding F3)
 *     This was rendering the full dashboard to any visitor when Supabase
 *     was absent — effectively running an unprotected trading UI in production.
 *
 * REPLACED WITH:
 *   - When Supabase is not configured: render an explicit configuration error.
 *   - When Supabase IS configured but user is unauthenticated: redirect to /auth.
 *   - When loading: spinner (unchanged).
 *   - When authenticated: render children (unchanged).
 *
 * The dashboard is never accessible without a real authenticated session.
 */

import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthProvider";

// ---------------------------------------------------------------------------
// Auth-unconfigured error — shown instead of bypassing auth
// ---------------------------------------------------------------------------

function AuthNotConfiguredError() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8">
      <div className="cyber-card p-8 max-w-md w-full space-y-4 border-warning/50 bg-warning/5">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-warning" />
          <h1 className="font-display text-lg font-bold text-warning uppercase tracking-wider">
            Auth Not Configured
          </h1>
        </div>
        <p className="text-sm font-mono text-muted-foreground leading-relaxed">
          Supabase authentication is not configured on this deployment.
          The dashboard is inaccessible until authentication is set up.
        </p>
        <div className="space-y-2 text-xs font-mono text-muted-foreground/70 border-t border-border pt-4">
          <p className="font-semibold text-muted-foreground">
            Required Vercel environment variables:
          </p>
          <p>
            <span className="text-warning">VITE_SUPABASE_URL</span>
            {" "}— your Supabase project URL
          </p>
          <p>
            <span className="text-warning">VITE_SUPABASE_PUBLISHABLE_KEY</span>
            {" "}— your Supabase anon/publishable key
          </p>
          <p className="pt-1 text-muted-foreground/50">
            Set these in Vercel → Project Settings → Environment Variables,
            then redeploy.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProtectedRoute
// ---------------------------------------------------------------------------

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, authUnconfigured } = useAuth();

  // PHASE 3: never bypass auth. Render explicit error when Supabase is absent.
  if (authUnconfigured) {
    return <AuthNotConfiguredError />;
  }

  // Loading state — same as before
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  // Unauthenticated — redirect to /auth
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Authenticated — render dashboard
  return <>{children}</>;
}
