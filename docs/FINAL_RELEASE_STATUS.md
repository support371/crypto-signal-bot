# Final Release Status

## Project

- Repo: `support371/crypto-signal-bot`
- Status: release candidate finalized
- Date: `2026-04-12`

## Finalized Build Scope

- Frontend install, lint, and production build verified
- Backend test suite verified (`129` passing tests)
- Windows backend bootstrap verified
- Windows release verification path verified
- Windows testnet doctor and certification wrapper added
- GitHub `main` updated with the final readiness fixes

## Validated Runtime Shape

- Safe default mode remains `paper`
- Hybrid paper mode supports:
  - execution exchange selection via `EXCHANGE`
  - public market-data exchange selection via `MARKET_DATA_PUBLIC_EXCHANGE`
- Confirmed intended hybrid configuration:

```env
TRADING_MODE=paper
EXCHANGE=bitget
PAPER_USE_LIVE_MARKET_DATA=true
MARKET_DATA_PUBLIC_EXCHANGE=btcc
NETWORK=testnet
```

## Finalization Result

The application build is finalized.

Remaining blockers are environment and network certification issues on the current workstation, not missing application features or unresolved build defects.

## Current Host Findings

- `api.bitget.com` is blocked by DNS failure on this workstation
- `api.btcc.com` resolves, but outbound TCP/HTTPS connection to port `443` times out on this workstation
- Docker Compose v2 is not installed on this workstation
- A separate local service is already bound to port `8000`, so isolated verification should prefer a different backend port such as `8011`

## Operational Meaning

- `bitget` remains the intended authenticated exchange path
- `btcc` remains the intended public market-data path for hybrid paper mode
- Full Bitget/BTCC exchange certification must be performed from a network that can actually resolve and reach those hosts

## Recommended Next Step

1. Move to a network that allows access to `api.bitget.com` and `api.btcc.com`
2. Re-run:

```powershell
.\scripts\testnet_certify_windows.ps1 -Doctor -Exchange bitget
.\scripts\testnet_certify_windows.ps1 -Doctor -Exchange btcc -DryRun
```

3. If Bitget credentials are available and connectivity is restored:

```powershell
.\scripts\testnet_certify_windows.ps1 -InstallCcxt -Exchange bitget -DryRun
.\scripts\testnet_certify_windows.ps1 -Exchange bitget
```
