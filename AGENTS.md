# AGENTS.md

Guidance for contributors - human and AI agents - working in this repo.

## Repository map

- `docs/adr/` - architecture decision records, indexed in `docs/adr/README.md`; one decision per file. Accepted records are frozen: supersede with a new ADR, never edit one.
- `docs/stories/` - story records, newest first in `docs/stories/README.md`; the lifecycle (proposed -> planned -> in flight -> done) is documented there.
- `.agents/skills/` - the skill family the workflow runs on (below). `skills-lock.json` at the repo root locks externally sourced skills (`grilling`, `agent-browser`).
- `README.md` - the user-facing install/ops surface.
- Code layout is decided but not yet implemented: the repo is docs-only today. The pnpm workspace (`apps/web`, `packages/dsh-next-app`, `packages/dsh-api`) is specified in ADR-0007 and lands with the code.

## Workflow

Planning and delivery run through the skill family, one stage per skill:

1. `story` (`/story`) - record one user story under `docs/stories/`.
2. `plan-a-story` (`/plan-a-story`) - break a story into a parent issue with `task`-labeled sub-issues.
3. `implement-a-task` (`/implement-a-task`) - carry one task issue to a reviewable pull request.
4. `review` (`/review`) - axis-based PR review (spec, system design, repo standards, UI, security, docs discipline, verification claims, commit hygiene) with a gated merge.
5. `bookkeeping` (`/bookkeeping`) - the post-merge tail: close completed parents, keep checklists truthful, mark story records done, sweep drift.

GitHub issues are the source of truth for plans; story records change only at their Done step, performed by `bookkeeping`.

## Conventions

- Docs discipline per ADR-0005: doc changes ship together with the change that implies them; task lists stay truthful as work happens.
- dsh compatibility is enforced mechanically - contract tests, the boot invariant, future CI (ADR-0006, ADR-0008) - not by review opinion.
- Commit and branch conventions come from the environment the work runs in (its AGENTS.md or equivalent); this repo references them and does not restate them.

## Verification

None defined yet - the repo is docs-only. Until code lands, PRs state what was checked manually (link/render checks for docs, JSON validity for config). When the workspace lands, verification lives in the pnpm workspace scripts and the `dsh-api` contract tests (ADR-0006, ADR-0007).
