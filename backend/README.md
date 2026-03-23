# Crypto Signal Bot Backend

This backend is a simulated crypto automation control center designed for paper trading only.

## Implemented modules

1. **Listener** — generates market and listing events.
2. **Scorer** — scores opportunities from listener output.
3. **Guardian** — applies hard risk rules and approval logic.
4. **Execution Router** — turns approved intents into simulated orders and positions.
5. **Audit Store** — persists events, scores, approvals, rejections, orders, and fills.
6. **Health API** — exposes module status and runtime metrics.

## Run

```bash
cd backend
npm start
```

Default port: `8787`

## Important

- Default mode is `paper`.
- Bitget and BTCC settings are placeholders only.
- Data is persisted to JSON files in `backend/data/`.
