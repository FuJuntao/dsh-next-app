# ADR-0002: Repo structure — a two-member pnpm monorepo

Status: Accepted

Date: 2026-08-21

## Context

The repo contains two artifacts with different shapes and runtimes: the
Next app (Turbopack build, browser and server code) and the server-row
glue (a node build that runs inside the dsh process, resolving host
packages from the dsh installation, and which must never import app
code). A single package would force both worlds into one manifest.

## Decision

- The repo is a **pnpm workspace with a private root** (scripts and
  the toolchain catalog) and **two members**:
  - `apps/web` — the Next app (ADR-0001). The envelope protocol layer
    is future work: until the bridge story lands, the app carries no
    dsh-specific code.
  - `packages/dsh-next-app` — the published bundle: `cordis.patch.yml`,
    `dsh.bundle.patch`, and the row scaffold (`src/web-startup.ts`
    compiled to `lib/`).
- **No compile-time code crosses the member boundary.** There are no
  shared modules yet, so each member keeps its own tsconfig and
  TypeScript project references have nothing to express — they become
  the mechanism the day a shared package appears.
- The bundle declares no `workspace:*` dependencies; its runtime
  imports stay `{next, react, react-dom, own helpers}`; the host
  packages its rows name are peerDependencies resolved from the dsh
  installation. Its `prepack` builds the app and packs the `.next`
  output.

## Consequences

- Registry installs remain a plain tarball install of a
  self-contained bundle.
- No test suites exist yet: the test strategy — protocol contract
  tests, the version pin, and the boot invariant included — is
  designed from scratch with the bridge story.
- One build and one lint pass at the root; publishing is a bump of the
  bundle member plus pack/publish.
