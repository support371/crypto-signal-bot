## Goal

Add a single new file at the repo root, `AGENT_UPGRADE_BRIEF.md`, containing the full handoff brief for the next agent to upgrade `crypto-signal-bot-indol.vercel.app` to the 10/10 spec.

## Scope

- One new file: `AGENT_UPGRADE_BRIEF.md`
- No code, dependency, schema, route, or UI changes
- No other files touched

## File contents

The brief already drafted in the previous chat message, verbatim, including:

1. Header (target system, reference spec, mode, definition of done)
2. §0 Operating Rules (10 non-negotiables: audit first, small diffs, preserve sound logic, no fake success, config owns thresholds, risk supremacy, paper/live parity, determinism, safe-mode default, Lovable Cloud naming)
3. §1 Phase Plan (8 phases: Audit → Backend foundations → API contract → Frontend vNext → Auth & Security → Persistence → Testing → Docs & Runbook)
4. §2 Required Decision Flow (pseudocode + hard risk rules)
5. §3 Value & Earnings Model (formulas, defaults, UI surfaces, edge sources)
6. §4 Acceptance Checklist (10 DoD items)
7. §5 Communication Style (per-phase report format)

## Technical notes

- Pure documentation file, markdown, no frontmatter
- No build, lint, or test impact
- No memory updates needed (this is a one-off handoff artifact, not a project rule)

## Out of scope

- Implementing any phase of the brief itself — that is the next agent's job against the external repo
- Any changes to the current Lovable project's backend, frontend, or schema