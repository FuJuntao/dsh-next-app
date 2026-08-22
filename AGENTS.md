# AGENTS.md

Guidance for contributors - human and AI agents - working in this repo.

## Repository map

- `docs/adr/` - architecture decision records, indexed in `docs/adr/README.md`; one decision per file. Accepted records are frozen: supersede with a new ADR, never edit one.
- `.agents/skills/` - the skill family the workflow runs on (below). `skills-lock.json` at the repo root locks the externally sourced skills - see that file for the current list.
- `README.md` - the user-facing install/ops surface.
- The code is a pnpm workspace (ADR-0002): `apps/web` (the Next.js app; the envelope protocol layer lands with the bridge story) and `packages/dsh-next-app` (the published bundle: `cordis.patch.yml`, `dsh.bundle.patch`, and the `lib/` server-row glue). The members share no compile-time code; each keeps its own tsconfig.

## Workflow

Planning and delivery run through the skill family, one stage per skill:

1. `story` (`/story`) - create and plan one story in one step: interview the story and its task breakdown, then create the GitHub parent issue with `task`-labeled sub-issues. Stories and plans live in GitHub issues only (ADR-0005).
2. `implement-a-task` (`/implement-a-task`) - carry one task issue to a reviewable pull request.
3. `review` (`/review`) - axis-based PR review (spec, system design, repo standards, UI, security, docs discipline, verification claims, commit hygiene) with a gated merge.
4. `bookkeeping` (`/bookkeeping`) - the post-merge tail: close completed parents, keep checklists truthful, sweep drift.

The story lifecycle is tracked by the issues: **planned** - the parent issue exists with its Tasks checklist; **in flight** - task issues are being implemented; **done** - the parent's checklist is complete and `bookkeeping` closes the parent.

The current skill set lives in `.agents/skills/`. GitHub issues are the source of truth for stories and plans (ADR-0005); decisions live in `docs/adr/`.

## Conventions

- Docs discipline per ADR-0004: doc changes ship together with the change that implies them; task lists stay truthful as work happens.
- dsh compatibility is enforced mechanically - install-time peerDependency ranges and regression coverage (ADR-0006) - not by review opinion or a boot-time version check.
- Commit and branch conventions come from the environment the work runs in (its AGENTS.md or equivalent); this repo references them and does not restate them.
- Refer, don't restate: facts that drift - the locked-skills list, the skill set, current verification state - are pointed at their source of truth, never enumerated here. This doc carries structure and process; status lives in its sources.

## Verification

Run at the repo root - `corepack pnpm` picks up the pinned package manager from `package.json`:

- `pnpm install` - install dependencies (lockfile is committed)
- `pnpm build` - build the app (`next build`) and the bundle glue (`tsdown`)
- `pnpm test` - no test suites yet; the e2e regression suite defined by ADR-0006 ships with its story
- `pnpm lint` - oxlint over the repo (shared root config)
- `pnpm format`, or `oxfmt --check .` for a check-only pass - oxfmt over code files

Version drift protection is install-time peerDependency ranges plus regression coverage (ADR-0006) - no pinned version constant or boot-time version check.
