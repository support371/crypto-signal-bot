# Vercel Environment Variables

This document describes the environment variables required for the Crypto Signal Bot frontend deployed on Vercel.

## Required Variables

### Backend Connection

```
VITE_BACKEND_URL=https://crypto-signal-bot-deqd.onrender.com
```

This is the primary backend URL. The frontend supports multiple env var names for backwards compatibility:
- `VITE_BACKEND_URL` (preferred)
- `VITE_BACKEND_BASE_URL`
- `VITE_CRYPTOCORE_API_BASE`
- `VITE_API_URL`
- `NEXT_PUBLIC_BACKEND_URL`

Production should standardize on `VITE_BACKEND_URL`.

## Optional Variables

### Authentication (Supabase)

For production authentication, set both:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Alternative names supported:
- `VITE_SUPABASE_PUBLISHABLE_KEY` (same as anon key)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Demo Mode

For paper/demo releases without authentication:

```
VITE_DEMO_MODE=true
```

When enabled AND Supabase is not configured:
- Dashboard is accessible without authentication
- A visible "DEMO PAPER MODE" banner is displayed
- Live trading is disabled
- Paper trading remains available

**Warning**: Only enable demo mode for evaluation/demonstration purposes. Never enable demo mode with live trading credentials.

## Vercel Dashboard Setup

1. Go to your Vercel project dashboard
2. Navigate to Settings > Environment Variables
3. Add each variable with appropriate scope (Production, Preview, Development)

## Environment Validation

The frontend validates environment configuration at startup:
- Missing `VITE_BACKEND_URL` in production builds shows an error
- Partial Supabase configuration (URL without key or vice versa) shows a warning
- Demo mode warnings are logged when enabled

## Security Notes

- Never commit `.env` files with real credentials
- Use Vercel's environment variable encryption
- Backend API keys should only be stored on the backend (Render)
- The frontend only needs the backend URL, not the backend API key
