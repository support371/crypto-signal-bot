# Command Center Salvage Map

This map records how future command-centre work should be handled while preserving the current Vite and FastAPI baseline.

## Decision model

| Action | Meaning |
|---|---|
| KEEP | Preserve existing working code. |
| EXTEND | Build on the current implementation. |
| PORT | Move compatible logic after review. |
| REWRITE | Reimplement the idea in the current architecture. |
| REJECT | Do not import the candidate. |

## Current branch decisions

| Area | Decision | Notes |
|---|---|---|
| Public pages | EXTEND | `/public`, `/integrations`, and `/waitlist` are initial pages. |
| Provider registry | EXTEND | JSON storage is suitable for alpha and can move to durable storage later. |
| Compatibility API | EXTEND | The new router wraps existing backend services. |
| Companion dashboard projects | PORT selectively | Use design and data-contract ideas only after review. |
| Historical backend branches | PORT selectively | Compare carefully before moving logic. |

## Operating rules

1. Keep the current Vite frontend and FastAPI backend as the baseline.
2. Avoid broad historical branch merges.
3. Add tests with each ported feature.
4. Keep deployment changes small and reversible.
