# BTCC provider contract status

**Last verified:** 2026-09-29

## Current engineering status

BTCC remains the configured primary execution provider, but the repository must
treat BTCC mutation capability as **fail-closed / unavailable** until a current
provider contract is verified.

This is a provider-contract blocker, not a reason to invent endpoints or bypass
the existing live-execution safety architecture.

## Current official provider evidence

BTCC published **Futures API Upgrade & Maintenance Notice** on 2026-02-13:

- Futures API services were suspended for an upgrade.
- The API application portal was closed during the upgrade.
- BTCC stated that it would publish an announcement when API services were
  restored.

Official notice:

https://www.btcc.com/en-US/detail/176811

As of the verification date above, repository maintainers have not established a
newer official BTCC announcement or current public REST trading specification
that proves Futures API mutation service has been restored.

## Historical documentation

CCXT issue #22623 ("New Exchange Request: BTCC") records a historical BTCC API
support URL and two attached documents from 2023:

https://github.com/ccxt/ccxt/issues/22623

The issue links:

- `BTCC_EN - TradeOpenApi_Nov2023.pdf`
- `BTCC_EN - OpenAPI_quote_websocket.docx.pdf`

These are useful historical reference material only. They do **not** establish
that the 2026 Futures API service is currently available, nor that endpoint,
authentication, rate-limit, product, or error contracts remain unchanged.

The historical BTCC support URL referenced by that issue no longer exposes the
API specification content when fetched on 2026-09-29.

## Repository policy

Until the blocker is cleared:

1. Do not promote guessed BTCC endpoints from legacy Python code.
2. Do not enable BTCC provider mutation.
3. Do not infer current signing rules from historical documents alone.
4. Do not enable mainnet merely because BTCC remains configured as primary.
5. Read-only/public market evidence may be used only where its contract is
   independently verified.
6. An ambiguous BTCC submission must never automatically fail over to Bitget.
7. Bitget demo certification may proceed independently, but it must not be
   represented as proof of BTCC execution readiness.

## Evidence required to clear the blocker

Before BTCC can become `CERTIFIED` for provider execution, obtain and review
current authoritative evidence for all of the following:

- API service restoration / application availability;
- supported environment(s), including any demo/test facility;
- API origin and version;
- authentication and signing algorithm;
- timestamp/nonce requirements;
- product/symbol identifiers;
- product rules: tick size, quantity step, minimum/maximum quantity/notional;
- market and limit order submission;
- client order identifiers / idempotency behavior;
- order status lookup;
- open-order lookup;
- cancellation;
- partial-fill representation;
- fee representation;
- balance and position lookup;
- rate limits;
- timeout and ambiguous-result semantics;
- provider error-code catalog;
- maintenance behavior;
- websocket/private-stream contract if used;
- account/API-key permission requirements.

After current provider evidence is obtained, implement or reconcile the adapter
against that evidence, add contract fixtures/tests, run failure injection, and
only then move BTCC through:

`IMPLEMENTED -> CERTIFIED -> CONFIGURED -> ARMED -> ACTIVE`

Activation remains a separate owner decision.
