# ADR-0005: Open source (MIT) + docs discipline in the repo

Status: Accepted

Date: 2026-08-16

## Context

The project is open source, and agents must pick up all technical
decisions, plans, and tasks from the repo itself — not from conversation
memory. Agent continuity across sessions is only as good as the repo's
documentation.

## Decision

- License: **MIT** (Copyright dsh-next-app contributors).
- All context lives in the repo: one ADR file per decision under
  `docs/adr/` (index in `docs/adr/README.md`), with `README.md` as the
  user-facing install/ops surface.
- Discipline: an ADR is Accepted once its decision is settled — after
  that it is frozen (supersede with a new ADR, never edit); doc changes
  ship together with the change that implies them; task lists stay
  truthful as work happens.
- The repo is generic and public — no deployment-specific details;
  deployment glue lives outside this repo.

## Consequences

- Every agent (human or AI) starts from the same records; decisions
  survive session recreation.
- Doc maintenance is mandatory overhead on every change — the cost of
  reliable agent pickup.
- Public scrutiny: commits, docs, and code quality are visible; no
  secrets may ever enter the repo.
