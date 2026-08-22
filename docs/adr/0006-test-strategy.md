# ADR-0006: Test strategy — e2e regression against a real dsh profile as the first suite

Status: Accepted

Date: 2026-08-22

## Context

The repo has no automated tests: no workspace member has a `test` script, so
`pnpm test` at the root (and the CI `Test` step) runs nothing. The boot-glue
story (#63) deliberately deferred them — "the dedicated test-strategy ADR
first, then its own story" — and ADR-0002's consequences predicted the strategy
"will be designed from scratch with the bridge story"; the bridge story is
scoped to the envelope layer, so that prediction is superseded by this record.
The runtime row already carries a regression note demanding a test that pins
the Next ready marker, so a Next catalog bump that changes the child's stdout
fails loudly instead of silently never announcing the URL. End to end here
means booting the artifact users actually install: the catalog-pinned dsh
host version (the README's "Targets" line names the currently tested one),
the packed bundle tarball, and the served page in a real browser.

## Decision

- **One e2e regression suite, and the workspace gains an `e2e/` member**
  (amending ADR-0002's two-member workspace). The suite is driven by
  `pnpm test` at the root and runs as a separate CI job — dsh boot is slow,
  so it stays off the fast path.
- **Runner: Playwright Test** (`@playwright/test`, pinned in the workspace
  catalog), **headless Chromium only**; no browser matrix until a UI story
  needs one. The catalog's `vitest` pin remains the candidate for future
  unit-level suites, chosen when the first one lands.
- **The suite boots the packed tarball** — never the repo tree — in a
  **scratch profile**: a throwaway `DSH_HOME` (`mkdtemp` under
  `os.tmpdir()`), the profile initialized on demand via
  `dsh plugin --profile <scratch> add <tarball>`, booted on a free port,
  teardown removing the scratch dir and killing the process tree. In-memory
  filesystems were considered and rejected: the suite spawns real child
  processes (dsh, pnpm, next) that need real filesystem paths; `/dev/shm` is
  too small (64 MB observed) for a ~100s-of-MB profile install; macOS and
  Windows CI have no tmpfs.
- **Host target: the catalog-pinned dsh host version**, installed from npm
  in CI — the number lives in the workspace catalog and the README's
  "Targets" line, never in this record. Drift protection remains
  install-time peerDependency ranges plus this regression coverage — no
  boot-time version check.
- **Initial suite scope**: boot/serve regression (a real browser loads `/`
  and asserts title and content; the dsh process announces the serving URL),
  supervision regression (child crash → backoff restart → served again;
  profile stop → child tree gone, port released), and the ready-marker pin (a
  Next catalog bump that changes the child's stdout fails loudly).
- **Boundaries**: bridge/envelope contract tests, auth-fence regression, the
  browser matrix, and golden-transcript replay land with their own stories;
  packaging-drill assertions are dropped (maintainer decision) and the suite
  asserts nothing about tarball contents or packed peerDependencies.

## Consequences

- The e2e suite becomes the regression net for the boot glue and every later
  surface change (bridge, auth, UI): regressions fail loudly in CI instead of
  reaching users as broken installs.
- `pnpm test` and the CI `Test` step remain no-ops until the suite lands
  with the e2e regression story's tasks.
- ADR-0002's frozen consequence text ("the test strategy … will be designed
  from scratch with the bridge story") is superseded by this record, never
  edited; its "two members" workspace letter is amended.
- Future suites (row-glue unit tests, envelope contract tests) are placed by
  this record until a later ADR supersedes it.
