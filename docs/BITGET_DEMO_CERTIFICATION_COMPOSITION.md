# Bitget Demo Certification Composition — Source Only

## Status

`demo-certification-composition.ts` assembles the reviewed Bitget demo certification path from explicit injected dependencies. It is source-only, place-only, non-public, unbound, and undeployed.

It does not select credentials, a fetch client, a clock, a Durable Object namespace, a recovery provider, or an account serializer implicitly.

## Required sequence

The composition performs this exact sequence:

1. validate all injected dependencies;
2. reject non-place candidates before reading D1 or using authority;
3. reload the independently reviewed demo authorization;
4. record or exactly replay the migration-027 place-control binding;
5. create the D1 fresh-control source;
6. wrap it with the existing private-brand verification loader;
7. create the callback-scoped credential adapter;
8. create the account-scoped Durable Object rate authority;
9. create the GET-only recovery boundary;
10. invoke the existing one-shot reviewed demo certification runner;
11. recheck every permanent capability lock on the resulting evidence.

## Injected dependencies

The caller must supply:

- D1 evidence environment;
- account-scoped serializer;
- callback-scoped demo credential lease source;
- account rate-limit Durable Object namespace;
- GET-only recovery lookup source;
- demo-only fetcher;
- trusted clock;
- optional request/response/deadline limits.

There is no default fetcher, no concrete Secrets Store implementation, no runtime route, and no Wrangler binding.

## Place-only restriction

The composition accepts `PLACE` candidates only. Migration 027 binds those candidates to an immutable locked assessment and approved risk decision.

Cancel and cancel-replace remain blocked because the repository does not yet contain an equally authoritative current-risk source for those operations. The composition does not fabricate one.

## Safety

The composition output always records:

- `sourceOnly = true`;
- `demoCertificationOnly = true`;
- `providerMutationAllowed = false`;
- `executionAllowed = false`;
- `liveExecutionAllowed = false`;
- `realFundsAllowed = false`;
- `mainnetAllowed = false`;
- `withdrawalsAllowed = false`;
- `automaticRetryAllowed = false`;
- `accountingAutomaticallyDispatched = false`.

CI statically verifies authorization → control binding → adapters → runner ordering, dependency injection, place-only enforcement, absence of concrete secrets/default fetch, and absence from every Worker entrypoint and Wrangler configuration.

## Validation

The provider suite tests:

- non-place rejection before D1, credentials, rate authority, recovery, or fetch;
- required serializer rejection before authority use;
- invalid clock rejection before authority use.

The deeper runner, runtime-adapter, migration-027, evidence-store, transport, recovery, and rate-limit behavior remains covered by their dedicated suites.

## Remaining boundary

No deployed demo certification environment exists. The next safe engineering task is an immutable readiness manifest that reports which isolated resources and adapter implementations are present or missing without deploying them, accessing credentials, or executing a provider request.
