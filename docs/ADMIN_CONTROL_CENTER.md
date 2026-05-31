# Admin Control Center

The dashboard admin layer is implemented as the **Command Console**.

## Frontend files

- `src/components/dashboard/CommandConsolePanel.tsx`
- `src/hooks/useConsole.ts`
- `src/components/dashboard/SettingsModal.tsx`
- `src/lib/backend.ts`

## Backend route group

All admin control routes are under:

```text
/api/v1/console
```

Key routes:

```text
GET    /api/v1/console/status
GET    /api/v1/console/audit
POST   /api/v1/console/trade
POST   /api/v1/console/signal-override
DELETE /api/v1/console/signal-override/{symbol}
POST   /api/v1/console/signal-reeval
POST   /api/v1/console/kill-switch
POST   /api/v1/console/guardian/reset
GET    /api/v1/console/guardian/status
POST   /api/v1/console/positions/close
POST   /api/v1/console/positions/close-all
POST   /api/v1/console/positions/cancel-order
POST   /api/v1/console/guardian/thresholds
GET    /api/v1/console/guardian/thresholds
POST   /api/v1/console/portfolio/reset
GET    /api/v1/console/version
```

## Operator API key flow

When backend auth is enabled with:

```env
BACKEND_API_KEY=your-secure-operator-key
```

protected admin write actions require the dashboard to send:

```http
X-API-Key: your-secure-operator-key
```

The dashboard now supports this flow:

1. Open the dashboard.
2. Open **Settings**.
3. Enter the same value used for backend `BACKEND_API_KEY` in **Operator API Key**.
4. Save settings.
5. Admin requests made through the shared backend fetch helper automatically include `X-API-Key`.

The key is saved only in this browser's local storage. Do not commit real operator keys to git, `.env.example`, screenshots, or deployment logs.

## Safety rules

- Keep paper mode as the default operating mode.
- Keep `BACKEND_API_KEY` enabled on production/staging backends.
- Keep `ALLOW_MAINNET` unset unless a controlled mainnet release is intentionally approved.
- Treat **manual trade**, **kill switch**, **portfolio reset**, **threshold updates**, and **position close** as privileged operator actions.
- Prefer testnet or paper-mode verification before enabling live exchange credentials.

## Verification

Run frontend build verification:

```bash
npm run build
```

Run backend console route tests:

```bash
python -m pytest tests/routes/test_console_v1.py -q
```

Run the new focused backend regression tests:

```bash
python -m pytest backend/tests/test_kill_switch_scope.py backend/tests/test_paper_trading_fill.py backend/tests/test_reconciliation_status.py -q
```
