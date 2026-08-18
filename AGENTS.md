# AGENTS.md

Guidance for contributors - human and AI agents - working in this repo.

## Repository map

- `docs/adr/` - architecture decision records, indexed in `docs/adr/README.md`; one decision per file. Accepted records are frozen: supersede with a new ADR, never edit one.
- `docs/stories/` - story records, newest first in `docs/stories/README.md`; the lifecycle (proposed -> planned -> in flight -> done) is documented there.
- `.agents/skills/` - the skill family the workflow runs on (below). `skills-lock.json` at the repo root locks the externally sourced skills - see that file for the current list.
- `README.md` - the user-facing install/ops surface.
- The code is a pnpm workspace (ADR-0007): a private root owning the shared scripts and the toolchain catalog, `apps/web` (the Next.js app), `packages/dsh-api` (typed client: dsh version pin + boot invariant), and `packages/dsh-next-app` (the published bundle: manifest, patch placeholders, and `lib/` glue).

## Workflow

Planning and delivery run through the skill family, one stage per skill:

1. `story` (`/story`) - record one user story under `docs/stories/`.
2. `plan-a-story` (`/plan-a-story`) - break a story into a parent issue with `task`-labeled sub-issues.
3. `implement-a-task` (`/implement-a-task`) - carry one task issue to a reviewable pull request.
4. `review` (`/review`) - axis-based PR review (spec, system design, repo standards, UI, security, docs discipline, verification claims, commit hygiene) with a gated merge.
5. `bookkeeping` (`/bookkeeping`) - the post-merge tail: close completed parents, keep checklists truthful, mark story records done, sweep drift.

The current skill set lives in `.agents/skills/`. GitHub issues are the source of truth for plans; story records change only at their Done step, performed by `bookkeeping`.

## Conventions

- Docs discipline per ADR-0005: doc changes ship together with the change that implies them; task lists stay truthful as work happens.
- dsh compatibility is enforced mechanically - contract tests, the boot invariant, future CI (ADR-0006, ADR-0008) - not by review opinion.
- Commit and branch conventions come from the environment the work runs in (its AGENTS.md or equivalent); this repo references them and does not restate them.
- Refer, don't restate: facts that drift - the locked-skills list, the skill set, current verification state - are pointed at their source of truth, never enumerated here. This doc carries structure and process; status lives in its sources.

## Verification

Run at the workspace root - `corepack pnpm` picks up the pinned package manager from `package.json`:

- `pnpm install` - install the workspace (lockfile is committed)
- `pnpm build` - build every member (`dsh-api` and the bundle with `tsc`, `apps/web` with `next build`)
- `pnpm test` - run the vitest suites
- `pnpm lint` - oxlint over all members (shared root config)
- `pnpm format`, or `oxfmt --check .` for a check-only pass - oxfmt over code files

Version drift protection is the pinned dsh version constant plus the fail-loudly boot invariant in `dsh-api` (ADR-0006, ADR-0008). The contract tests against a live dsh host are future work (ADR-0006).
