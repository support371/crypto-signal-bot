# Bitget Demo Control Bindings — Migration 027

## Status

Migration 027 and `demo-control-binding-store.ts` provide the immutable source mapping required to reload current Guardian, risk, and idempotency evidence immediately before a source-only Bitget demo certification attempt.

This layer does not submit an order, expose a route, access credentials, bind a Durable Object, deploy a Worker, retry a provider request, dispatch accounting, or enable live/mainnet/real-funds capability.

## Place-only boundary

The mapping accepts `PLACE` candidates only. A place candidate must already bind an immutable Bitget assessment with:

- `READY_BUT_EXECUTION_LOCKED` status;
- all operational checks passed;
- `execution_allowed = 0`;
- an exact preview hash matching the candidate;
- an approved risk decision;
- the same exchange account and provider identity.

Cancel and cancel-replace candidates remain unsupported by this mapping until they have an equally authoritative current-risk source. No risk decision is fabricated for those operations.

## Guardian evidence

Each binding records a sorted, unique Guardian scope set and the reviewed state-version hash. The required scopes are:

- global;
- Bitget demo environment;
- Bitget exchange;
- exchange account;
- product symbol;
- order type.

Every state must be `CLEAR`. The D1 reload source recomputes the entire Guardian state hash. Any version or status change after review fails closed.

## Risk evidence

The binding stores the exact risk decision identity, configuration version, and decision hash from the locked assessment. The D1 reload source requires the decision to remain unchanged and no more than two seconds old at the final control evaluation time.

## Idempotency evidence

The binding stores the durable idempotency operation identity, operation scope, and a SHA-256 hash of the idempotency key. The raw key is not persisted in migration 027.

Final reload requires the existing record to remain `CLAIMED`, account/key matched, unexpired, and without a response or error. Completed, failed, or expired operations cannot authorize demo certification.

## Immutable persistence

`live_bitget_demo_place_control_bindings` is append-only:

- one authorization, dispatch attempt, candidate, assessment, and idempotency operation per binding;
- exact control-binding hash;
- no-update and no-delete triggers;
- all provider mutation, execution, live, real-funds, mainnet, withdrawal, automatic retry, and automatic accounting flags constrained to zero.

Migration verification applies the full sequence through 027 from an empty database, upgrades from migration 019, replays migrations 020–027, inserts a valid control-binding chain, and proves that the row cannot be updated or deleted.

## Runtime isolation

The store and D1 reload source remain source-only. Static verification rejects:

- Worker entrypoint imports;
- Wrangler bindings;
- secret names or Secrets Store access;
- network fetch or signing code;
- true execution or mutation flags;
- non-place candidates;
- missing current Guardian/risk/idempotency checks.

## Next boundary

The next safe engineering task is a source-only composition factory that assembles the reviewed demo certification runner from injected D1, serializer, credential-lease, account-rate, GET-only recovery, clock, and fetch dependencies. It must remain non-public, unbound, undeployed, and permanently demo-only.
