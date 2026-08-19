# Scaffold the pnpm workspace for real code

- Date: 2026-08-18

As a contributor, I want the pnpm workspace scaffolded per ADR-0007 (private
root, `apps/web`, `packages/dsh-next-app`, `packages/dsh-api`) with runnable
stubs and scripts, so that I can start working on this repo with real code
instead of a docs-only tree.

## Acceptance Criteria

1. A clean clone runs `pnpm install` at the root successfully, with the
   package manager pinned (`packageManager` field) and the lockfile committed.
2. All three workspace members exist with manifests and entry stubs honoring
   ADR-0007 boundaries: `packages/dsh-next-app` declares no `workspace:*`
   dependencies and none on its members; `apps/web` links `packages/dsh-api`
   via `workspace:*`.
3. Root scripts `build`, `test`, `lint` exist and exit 0 on the scaffold;
   linting uses the Oxc stack (`oxlint`), not ESLint.
4. `packages/dsh-api` contains the pinned dsh version constant
   (`0.1.0-rc.7`, the latest release) and a fail-loudly boot-check stub
   (ADR-0006, ADR-0008); the README supported-dsh-version line is updated to
   match (ADR-0005).
5. The toolchain (Next.js, React, TypeScript, pnpm) is pinned to the latest
   stable versions at scaffolding time.
6. Root `test` runs vitest; the scaffold includes one passing test asserting
   the pinned dsh version constant.
7. README/AGENTS verification sections point at the workspace scripts
   (ADR-0005 docs discipline).

## Non-Goals

- No real UI features beyond a placeholder page.
- No dsh-api client logic beyond the version-pin and boot-check stubs.
- No contract tests against a live dsh host.
- No npm publishing drill or `prepack` wiring.
- No CI workflow.
- No prettier or husky.

## Technical Notes

- Workspace layout and dependency boundaries per ADR-0007; Next.js App
  Router shell per ADR-0001; version pin and boot invariant per
  ADR-0006/ADR-0008.
- Linting via the Oxc stack (`oxlint`); tests via vitest.
- dsh pin moves from `0.1.0-rc.6` to `0.1.0-rc.7` (npm `latest` and the
  version installed in the working environment).

## Priority

High - blocks every code-carrying task in the repo.
