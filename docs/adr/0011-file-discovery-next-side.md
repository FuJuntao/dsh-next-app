# ADR-0011: @-reference discovery walks the filesystem Next-side, fenced per session

Status: Accepted

Date: 2026-09-05

## Context

Story #134 (chat island, AC 21/22) puts an `@` file-reference trigger on the
session page: typing `@` completes to file and directory paths inside that
session's working folder, and selecting one inserts a path reference - never
file contents.

No existing door answers this query from Next's side:

- `FileReferenceService.list(agent, query)` is a host Cordis seam, reached
  by the terminal through the typert Remote transport. It is registered in
  no `RpcMethodMap` row, and the envelope bridge defines no routes
  (ADR-0010) - so the method is unreachable over the bridge by design.
- `host.listDirectory` is reachable but documented to return direct child
  **directories** only. A file-candidate list cannot be built from it
  without one round trip per level, and completion wants fuzzy matching
  across the whole tree.

So the candidate list has to be produced by this app, which makes the chat
page the product path's first Next-side filesystem read. The precedent for
Next-side reads is the cwd picker's browse door and the skills read, both
fenced to the host default folder (ADR-0001's single-surface model,
ADR-0008/0009's config, ADR-0010's bridge); discovery differs in that its
root is the SESSION's own cwd, which is per-row data, not the deployment
default.

## Decision

The app walks the session's cwd server-side (`apps/web/lib/file-discovery.ts`,
a server action), under these rules:

- **The root is server-resolved, never client-named.** The action takes a
  sessionId plus a filter query; the root is the session's `cwd` from
  `session.list`. The query is treated as opaque filter text and never
  joined to the filesystem.
- **Shared containment fence.** `lib/host-path.ts` grows `fenceUnderRoot` -
  the same climb-safe realpath canonicalization the host-root fence uses -
  applied per session root. Relative-only, `..`-free, and the realpath of
  every candidate must land inside the realpath of the root: parent
  segments, absolute paths, and symlinked directories escaping the root are
  refused before a candidate is ever listed.
- **Git first, and bounded like everything else.** When the root is a git
  working tree, candidates come from
  `git ls-files --cached --others --exclude-standard -z`: ignore-correct
  (respects `.gitignore`, so `node_modules` and build output never appear) and
  NUL-delimited for exotic names. The stream is read through an incremental
  record counter with a hard ceiling (`LIST_MAX_ENTRIES` records,
  `LIST_MAX_BYTES` of output): at either ceiling the child is killed, the
  result is marked `partial`, and the cost stops there. "Bounded by the repo's
  own rules" is not a bound - `.gitignore` says what may be *listed*, not what
  a listing may *cost*. Directory candidates are derived from the file paths'
  ancestors, and that expansion counts toward the same ceiling. Git output is
  still containment-checked before listing.
- **Bounded readdir fallback.** Without git, an async recursive walk with depth
  (10) and entry (20k) caps skips `.git`, `node_modules`, `dist`, and
  dot-directories, and partial results are simply partial.
- **Brief cache, hard cancel.** The candidate list is cached per root for 5
  seconds, and the cache holds at most `CACHE_MAX_ROOTS` roots - expired
  records are dropped on every write, and the oldest go first. A TTL bounds
  how stale a listing may be; only a count bounds how many full-tree listings a
  long-lived process can accumulate. A newer search for the same root aborts
  the older scan: the child process dies with its signal, and the fallback
  walk is async `fs/promises` so the abort lands MID-scan - a synchronous walk
  can poll `signal.aborted` a thousand times and never observe it, because
  nothing else runs inside one Node turn. The client's latest-wins guard drops
  stale arrivals - a fast typist is never overtaken by a slow walk.
- **Paths only, host grammar only.** The response is session-relative
  paths plus the insertion text produced by the vendored
  `@deepseek-ai/dsh-file-reference/grammar` (`formatFileMention`); the
  composer's trigger is the same package's `activeAtToken`, not a
  reimplementation. Selections insert references - file contents are never
  read. Directory mentions keep a quoted token open so completion can
  descend (pinned by `lib/vendored-grammar.test.ts`).
- **Fence.** The action, like every browser-facing door, rides the existing
  basic-auth middleware (AC 24); no new credential surface.

## Consequences

- The Next process holds read-only directory-listing access to session
  working folders - strictly broader than the bridge's method reach but
  strictly narrower than the shell: names only, fence-bound, git-ignored
  excluded, and behind the same fence as everything else.
- Ignore-awareness is delegated to git when present; the fallback walk is
  not `.gitignore`-aware (it is the cap-bounded approximation, and repos -
  the common case - get the precise list).
- The host's `FileReferenceService` remains the terminal's path; the two
  implementations share the grammar package so their tokenization cannot
  drift, and a future host route over `session.*` can retire this walk
  without UI change.
- Staleness: a 5-second cache means a file created in the same breath may
  not complete yet; the next keystroke re-queries. Accepted for a UX
  affordance - prompts re-resolve paths at execution, where correctness is
  owned by the tools.
