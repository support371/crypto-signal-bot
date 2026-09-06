# Deployment Status

Current intended production identity:

- Frontend: `https://crypto-signal-bot-indol.vercel.app`
- Worker: `https://crypto-signal-bot-api.analyzer-d94.workers.dev`
- D1: `crypto-signal-bot-db`
- Execution hierarchy: BTCC -> Bitget
- Public market data: Coinbase
- Release posture: paper / testnet / no real funds / no withdrawals / no provider mutation

A deployment is accepted only when the canonical Vercel alias serves the accepted main SHA and `/api/release-attestation` is healthy. Generated READY previews alone are not sufficient.
