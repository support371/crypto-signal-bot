# Runtime-Control Salvage Decision

Source reviewed: `finalize-crypto-risk-agent-build`

Decision: do not port code from this branch into `main`.

Reason: the current `main` branch already has the newer runtime-control surface. The reviewed areas on `main` are broader than the legacy branch:

- exchange adapter handling
- public market-data handling
- startup checks
- runtime config and settings
- release verification scripts
- testnet and live-paper smoke scripts
- event/audit support

Outcome:

- Code port: none
- Documentation added: this note
- Recommended next salvage targets:
  - `feat/build-trading-platform-14047153187029945517`
  - `jules-backend-setup-11315302861801406339`

This prevents repeated review of the same legacy branch and keeps the salvage process focused on branches that may still contain standalone product logic.
