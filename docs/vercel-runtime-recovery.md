# Vercel Runtime Recovery

## Purpose

The Vercel build can pass while the browser still renders a blank page because of missing environment variables or an uncaught runtime error. The frontend now renders a visible setup/recovery screen instead of leaving the root blank.

## Required production variables

Set these in Vercel under Project Settings → Environment Variables → Production:

```env
VITE_BACKEND_URL=https://your-backend.example.com
```

If Supabase auth is enabled, also set:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-public-anon-key
```

The app also accepts this alias:

```env
VITE_SUPABASE_ANON_KEY=your-public-anon-key
```

## Behavior

- Missing or localhost backend URL in production renders the setup screen.
- Partial Supabase configuration renders diagnostics instead of crashing silently.
- Unexpected React render failures render the recovery screen with a reload button.
- Early root-render failures render a plain HTML recovery screen.

## Redeploy

After editing variables in Vercel:

1. Go to Deployments.
2. Select the latest production deployment.
3. Choose Redeploy.
4. Visit the production alias and confirm the app renders the dashboard or setup screen.

## CircleCI note

CircleCI/GitHub Actions billing/account locks do not block Vercel from deploying. They only affect CI check visibility and merge-gate confidence.
