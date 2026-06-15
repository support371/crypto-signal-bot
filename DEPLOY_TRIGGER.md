# CryptoOps Paper-Safe Deploy Trigger

This file is not a live-trading trigger.

Current required execution posture:

- TRADING_MODE=paper
- EXCHANGE_MODE=paper
- ALLOW_MAINNET=false
- NETWORK=testnet
- /intent/live must return HTTP 403
- /withdraw must return HTTP 403

Production updates should use the guarded release lane only after paper-safety checks pass. Live trading and withdrawals remain disabled unless a separate future approval, secret-management, risk, Guardian, circuit-breaker, audit, rollback, and compliance process is completed.
