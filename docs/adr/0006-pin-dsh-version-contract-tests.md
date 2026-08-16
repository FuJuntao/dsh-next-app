# ADR-0006: Pin dsh version + contract tests for the internal /api protocol

Status: Accepted

Date: 2026-08-16

## Context

The `/api` gateway protocol this app consumes is an internal dsh
contract, not a public API: payloads, event names, and envelope rules can
change between releases. The same tax is visible wherever operators patch
the in-box client bundle: an upstream change breaks the patch — loudly
when it fails fast, silently when it doesn't. This app would inherit the
same risk invisibly: a quiet payload change would corrupt rendering, not
fail the build.

## Decision

- Pin the dsh version the app targets, recorded in the README.
- Phase 1 produces a **typed API client** plus **contract tests** that run
  against the live host, encoding every
  documented fact: envelope, endpoints, trust-fence presentation, event
  vocabulary, payload shapes.
- Upgrade procedure: bump dsh → run contract tests → diff the installed
  `.d.ts` schemas → update the pinned version and any changed facts in
  the same change. The pin is enforced at runtime by the ADR-0008
  invariant — fail loud, not just test-red.

## Consequences

- dsh upgrades become a ~1-hour diff-and-verify job instead of a
  debugging session.
- Contract tests must tolerate a host that also serves the in-box app;
  they never assume exclusive access to it.
- The runtime invariant (ADR-0008) turns a version mismatch into a boot
  error instead of corrupted rendering.
