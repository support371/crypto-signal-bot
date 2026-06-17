# CryptoOps Agent Autonomy Installation Guide

This guide arranges the remaining owner-side installation work after PR #112 is reviewed and merged.

## Current branch and PR

- Branch: `feat/agent-autonomy`
- PR: `#112`
- Deployment status: not triggered
- Runtime safety: paper/simulation only

## 1. Cloudflare KV setup

Create a KV namespace in Cloudflare:

- Name: `agent-memory`
- Purpose: persistent agent memory for `/agent/memory/:key`
- Data type: JSON string values
- TTL: 30 days, enforced by the Worker route

After creation, copy the namespace ID and replace this placeholder in `wrangler.toml`:

```toml
id = "PLACEHOLDER_REPLACE_WITH_REAL_KV_ID"
```

Do not redeploy while the placeholder remains.

## 2. GPT Builder Actions setup

Add these action schemas in the GPT editor:

1. `gpt-actions/worker-api.openapi.yaml`
2. `gpt-actions/github.openapi.yaml`
3. `gpt-actions/render.openapi.yaml`

Use private authentication fields only. Do not paste tokens into chat, markdown files, commits, workflow logs, or public comments.

## 3. GPT Instructions setup

Paste the full contents of:

```text
gpt-actions/SYSTEM_PROMPT.md
```

into the GPT Instructions field.

## 4. Validation order

After KV ID is replaced:

1. Run repo validation or CI on the branch.
2. Confirm Worker build passes.
3. Confirm paper safety remains enforced.
4. Confirm `/agent/context` returns a snapshot.
5. Confirm `/agent/memory/test` can write, read, and delete a value.

## 5. Deployment order

Only after validation passes:

1. Merge PR #112.
2. Redeploy the Cloudflare Worker.
3. Re-check `/runtime/status`.
4. Re-check `/guardian/status`.
5. Re-check `/agent/context`.

## Safety rules

- Keep `ALLOW_MAINNET=false`.
- Keep `TRADING_MODE=paper`.
- Keep `EXCHANGE_MODE=paper`.
- Do not enable live execution.
- Do not enable withdrawals.
- Do not commit secrets.
