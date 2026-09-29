# Mainnet service scope: market review and broker integration

## Owner direction

The client product target is a mainnet-capable crypto market review and exchange execution service. Do not market a simulated trading product. This document describes the target and the evidence needed to release it; it does not authorize a change to the current production financial-mutation controls.

## Market review sources

| Source | Intended role | Connection evidence today | Release gate |
| --- | --- | --- | --- |
| FOREX.com | Owner's broker account, market research, and potentially eligible FX or other supported instruments | Account reported by owner; no account-specific entity, symbol, API, or MT5 session verified in this application | Confirm legal entity, instruments, account permissions, API/MT5 path, and broker terms |
| Yahoo Finance | External market coverage and context | Public web pages only | Agree permitted access, attribution, and commercial data rights before automated ingestion or redistribution |
| Investopedia | Educational context and terminology | Public web pages only | Cite and paraphrase appropriately; no use as execution-price authority |

FOREX.com US states that cryptocurrency trading is not currently available there. Other entities advertise crypto CFDs, which are derivatives and not the same as owning crypto. Do not infer availability from the owner having an account.

Sources checked: https://www.forex.com/en-us/help-and-support/available-markets/ ; https://www.forex.com/en/cryptocurrency-trading/ ; https://www.forex.com/en-us/premium-trader-tools/api-trading/ ; https://finance.yahoo.com/markets/crypto/ ; https://www.investopedia.com/analyze-crypto-6456223 .

## Existing repository components

- The React frontend and Worker expose market, signal, risk, account, and audit surfaces.
- `backend/adapters/brokers/mt5.py` is a candidate MT5 adapter, requiring a local Windows terminal and authorized broker session. It is not a verified FOREX.com connection.
- BTCC is the intended primary crypto execution venue; Bitget is secondary; Coinbase is a public market-data source. Provider order mutation is currently blocked in the production release.
- The read-only `/market-review` page records source roles and missing integration evidence. It is not an automated news ingestion or investment-advice feature.

## Separate release gates

1. **Original market review:** define editorial ownership, timestamped citations, correction process, permitted data access, distribution rights, and account-specific research access. Do not copy third-party articles into client deliverables.
2. **FOREX.com account:** determine jurisdiction/entity, supported instruments, order permissions, and REST API or MT5 integration path. Do not reuse forex quotes as crypto execution prices.
3. **Crypto exchange execution:** verify provider documentation and authenticated permissions; implement venue-specific symbol and order rules, pre-trade risk, idempotency, order-state reconciliation, audit, guardian controls, and incident rollback.
4. **Client offer:** settle who owns funds and credentials, who may approve orders, fee disclosure, permitted jurisdictions, and legal review for advice, execution, and custody.
5. **Evidence:** measured integration behavior and operational review are required before describing a capability as live. Any live-mode change requires its own reviewed implementation and explicit release authorization under `AGENTS.md`.

No secrets belong in browser variables or repository files. This scope does not alter existing production execution locks.
