# Production Readiness

This document describes the production configuration and acceptance criteria for the Crypto Signal Bot.

## Production URLs

- **Frontend (Vercel)**: https://crypto-signal-bot-indol.vercel.app
- **Backend (Render)**: https://crypto-signal-bot-deqd.onrender.com

## Environment Configuration

### Vercel (Frontend)

```
VITE_BACKEND_URL=https://crypto-signal-bot-deqd.onrender.com
```

For production with authentication:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

For demo/evaluation mode (no auth):
```
VITE_DEMO_MODE=true
```

### Render (Backend)

```
TRADING_MODE=paper
CORS_ALLOWED_ORIGINS=https://crypto-signal-bot-indol.vercel.app
EVENT_LOG_ENABLED=true
EVENT_LOG_PATH=/tmp/crypto-signal-bot/event_log.db
AUDIT_STORE_PATH=/tmp/crypto-signal-bot/audit.json
EARNINGS_STORE_PATH=/tmp/crypto-signal-bot/earnings.json
BACKEND_API_KEY=<private>
```

## Acceptance Criteria

The deployment is considered production-ready when:

### 1. Dashboard Loads Successfully
- [ ] Vercel production loads dashboard without blank screen
- [ ] No JavaScript errors in console
- [ ] All panels render correctly

### 2. Backend Connectivity
- [ ] `/health` returns `{ "status": "ok" }`
- [ ] Frontend shows "SYSTEM OPERATIONAL" when backend is healthy
- [ ] Backend URL displayed in diagnostics: https://crypto-signal-bot-deqd.onrender.com

### 3. Resilient Error Handling
- [ ] `/health` success means frontend shows backend online
- [ ] Optional endpoint failures do NOT show global "backend unavailable"
- [ ] WebSocket failure does NOT show backend unavailable
- [ ] Diagnostics warning shows which specific endpoints failed

### 4. Trading Mode
- [ ] Paper/demo mode is clearly labeled
- [ ] `TRADING_MODE=paper` is set on backend
- [ ] Live trading is disabled unless explicitly configured

### 5. Security
- [ ] No secrets exposed in frontend code
- [ ] No API keys in browser console or network requests
- [ ] Backend API key stored only on Render, not Vercel
- [ ] CORS configured to only allow production frontend

### 6. Demo Mode (if enabled)
- [ ] "DEMO PAPER MODE" banner visible at top of dashboard
- [ ] Live trading blocked in demo mode
- [ ] Paper trading works correctly
- [ ] No authentication required

## Validation Commands

### Frontend Build
```bash
npm install
npm run build
npm run lint
```

### Backend Health Check
```bash
curl https://crypto-signal-bot-deqd.onrender.com/health
curl https://crypto-signal-bot-deqd.onrender.com/healthz
curl https://crypto-signal-bot-deqd.onrender.com/ready
```

### Backend Tests (if available)
```bash
python -m pytest backend/tests -q
python scripts/repo_audit.py
python scripts/security_hygiene_audit.py
```

## Monitoring

### Frontend Health Indicators
- Footer shows "SYSTEM OPERATIONAL" or "BACKEND DISCONNECTED"
- Footer shows "WS LIVE" or "WS OFFLINE"
- Kill switch status shown when active

### Backend Health Indicators
- `/health` returns status and uptime
- `/metrics` returns system metrics
- `/guardian/status` returns guardian/kill-switch state

## Troubleshooting

### "Backend unavailable" shown
1. Check if `/health` endpoint responds
2. Verify `VITE_BACKEND_URL` is set correctly in Vercel
3. Check CORS configuration on backend

### Some panels show errors but backend is online
1. Check diagnostics warning for specific failed endpoints
2. These are optional endpoints - backend is still online
3. Specific endpoint may be temporarily unavailable

### WebSocket shows offline
1. WebSocket failure is isolated from backend health
2. Dashboard continues to work via HTTP polling
3. Check if `/ws/updates` endpoint is available

### Demo mode not working
1. Verify `VITE_DEMO_MODE=true` is set
2. Ensure Supabase vars are NOT set (demo mode only works without auth)
3. Check for "DEMO PAPER MODE" banner at top

## Security Checklist

- [ ] No `.env` files committed to repository
- [ ] No hardcoded credentials in source code
- [ ] Backend API key only in Render environment
- [ ] Supabase keys only in Vercel environment
- [ ] CORS properly restricts origins
- [ ] HTTPS used for all production URLs
