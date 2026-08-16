# ADR-0007: pnpm workspace monorepo: private root, publishable bundle subpackage

Status: Accepted

Date: 2026-08-16

## Context

ADR-0002 originally pinned the repo root as the bundle package because a
git install put the repo root into the profile's `node_modules`.
Publishing to npm removes that constraint: the published artifact is
built and packed by the publishing package itself, so the repo root is
neither a profile nor a bundle. The typed `dsh-api` client (ADR-0006) is
independently useful and must survive a UI-layer rewrite (ADR-0001).

## Decision

- The repo is a **pnpm workspace whose root package is private** (never
  published): it owns the workspace, shared scripts, and docs, and
  declares no `dsh` fields.
- Workspace members: the **bundle package** at `packages/dsh-next-app`
  (the published deliverable, `@<scope>/dsh-next-app`:
  `dsh.bundle.patch`, `cordis.patch.yml`, and the `lib/` glue —
  `web-startup` and the server row), `packages/dsh-api` (typed fetch/SSE
  client, event vocabulary, contract tests), and `apps/web` (the
  Next.js app, ADR-0001).
- The bundle manifest declares **no `workspace:*` dependencies and no
  dependency on its members**: at runtime it imports only `next`,
  `react`, `react-dom`, and its own helpers; the in-box host packages
  its rows name are peerDependencies resolved from the dsh installation
  (ADR-0008). `workspace:*` links exist only between non-published
  members (`web` → `dsh-api`) at dev/build time; the bundle's `prepack`
  builds `apps/web` and copies the `.next` output in before
  pack/publish.
- Rejected: separate repos for client and app (the workspace keeps each
  release atomic across patch, glue, and frontend build); the repo root
  as the bundle (ADR-0002 no longer needs it).

## Consequences

- Registry installs are a plain `pnpm add` of a self-contained tarball:
  no `prepare` script, no `allowBuilds`, no committed build output
  (builds happen at publish time only).
- `dsh-api` tests run against a live host with no Next dependency — fast
  and CI-able; the client can be versioned or published independently.
- The bundle payload stays minimal: the `files` field ships the patch,
  the glue, and the frontend output only.
- Versioning is manual: publish = bump the bundle package and
  `pnpm publish` it; the packaging drill (install into a scratch
  profile, `--dump-default-config`) verifies the tarball contents.
  `prepack` builds with the workspace installed and must be idempotent
  (npm runs it on pack and on publish).
- New workspace members are cheap to add, but v1 keeps the workspace to
  these three members — no shared UI kit or extra apps without a new
  ADR.
