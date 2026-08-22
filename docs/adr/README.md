# Architecture Decision Records

One file per decision, numbered in the order the decisions were made.
An ADR is **Accepted** once its decision is settled; after that it is
frozen — supersede it with a new ADR, never edit it. Each record may
reference earlier records only.

The record set was reset once, on 2026-08-21, when the exploration
phase ended and the architecture settled into the current baseline
(PR #61): the pre-reset records 0001-0008 were retired and the
numbering restarted. They - and the story records dropped in the same
reset - live in git history; citations in issues, PRs, and story
records that predate the reset refer to that numbering.

| # | Title | Status |
| - | ----- | ------ |
| [0001](0001-purpose-nextjs-surface.md) | The repo's purpose — a Next.js web surface for dsh with a public API guarded by auth | Accepted |
| [0002](0002-repo-structure.md) | Repo structure — a two-member pnpm monorepo | Accepted |
| [0003](0003-nextjs-routes.md) | Next.js routes — app routes and /api over the unix-socket bridge | Accepted |
| [0004](0004-open-source-docs-discipline.md) | Open source (MIT) + docs discipline in the repo | Accepted |
| [0005](0005-one-step-story-planning.md) | Story planning — one step with GitHub issues as the single source of truth | Accepted |
