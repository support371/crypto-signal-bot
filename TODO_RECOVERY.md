# TODO Recovery Instruction

Use this file only if an agent went off-track or could not see the main repository TODO.

## Recovery instruction for any off-track agent

If you do not see `TODO.md` locally, your checkout is stale. Sync to the latest `main` branch before making changes.

Do not use `README_PROJECT_DRAFT.md` as the primary execution guide. It is stale/conflicting. Use `TODO.md` as the only canonical execution brief.

If you already made local changes from the stale draft, reassess them against `TODO.md`, keep only what helps the current app, and revise or revert anything that conflicts with the requirements there.

Do not claim completion from syntax checks alone. Completion requires all of the following:
- backend startup succeeds
- frontend startup succeeds
- frontend connects to backend
- tests pass
- frontend production build passes

## What to do now
1. Pull/sync the latest `main` branch.
2. Open `TODO.md`.
3. Follow `TODO.md` fully.
4. Use this file only as a correction layer if your previous run was based on stale instructions.
