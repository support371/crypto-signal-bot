# Bitget Demo Runtime Adapters — Source Only

## Status

The runtime adapter layer composes interfaces required by the source-only Bitget demo certification runner. It is not imported by any Worker entrypoint, has no Wrangler binding, route, trigger, default network client, concrete Secrets Store implementation, or deployed provider connection.

Every adapter remains hard-bound to `BITGET_DEMO`. Live execution, real funds, mainnet, withdrawals, accounting auto-dispatch, and automatic retry remain false.

## Implemented adapters

### Callback-scoped credential lease

`createBitgetDemoCallbackCredentialProvider` accepts an injected credential lease source. Material is frozen, used only inside one callback, and rejected when the source invokes the callback zero or multiple times. The adapter contains no concrete secret name, storage, logging, or serialization path.

### Fresh-control verification

`createVerifiedBitgetDemoFreshControlLoader` accepts an injected Guardian/risk/idempotency reload source and runs the existing private-brand verification against the reviewed candidate and authorization before returning evidence to the certification runner.

It does not fabricate control state or accept a stored boolean as current authority.

### Account-scoped Durable Object rate authority

`BitgetDemoRateLimitDurableObject` and `createBitgetDemoDurableRateLimitAuthorityProvider` wrap the reviewed strict sliding-window rate limiter. One deterministic Durable Object identity is selected per exchange account. The account identity becomes immutable in storage, request bodies are bounded, and every response is rebound to the exact claim.

The class is source-only and is not exported by a Worker entrypoint or bound in Wrangler configuration.

### GET-only ambiguous-result recovery

`createBitgetDemoGetOnlyRecoveryBoundary` accepts an injected read-only lookup source. It permits only the reviewed GET lookup instructions, verifies order identity and observation hashes, and produces a deterministic `RECOVERED` or `INCOMPLETE` receipt.

It never retries the demo mutation, dispatches accounting, changes reservations, or mutates provider state.

## Required validation

The provider test suite covers one-shot credential leasing, account-scoped Durable Object claims, fresh-control hash revalidation, recovered lookup evidence, and incomplete lookup evidence.

The required demo safety job executes the runtime-adapter static verifier. CI rejects entrypoint imports, Wrangler bindings, concrete secret names, default/global fetch, credential serialization, true live/mainnet/real-funds/withdrawal flags, automatic retry, and non-GET recovery.

## Remaining integration boundary

The following remain deliberately unimplemented:

- immutable D1 mapping from a reviewed demo attempt to the exact Guardian scopes, candidate assessment/risk decision, and durable idempotency record;
- concrete credential lease source;
- deployed account rate-limit Durable Object namespace;
- deployed GET-only recovery source;
- any Worker route or trigger for demo dispatch;
- external Bitget demo certification run;
- any live or real-money transport.

The next source-only task is the immutable fresh-control binding and D1 reload service. It must remain non-public and demo-locked.
