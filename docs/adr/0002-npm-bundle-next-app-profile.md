# ADR-0002: Publish as an npm bundle, layered into its own `next-app` profile

Status: Accepted

Date: 2026-08-16

## Context

dsh composes each profile from the ordered bundles listed in the
profile's own manifest (`dsh.profile.bundles`), and
`dsh plugin --profile <name> add <pkg>` installs a published package
into that profile — layering it automatically when the package declares
`dsh.bundle.patch`, the distribution format the in-box surface itself
uses (see the [dsh reference](https://deepseek-harness.github.io/deepseek-harness/en/reference/#profiles-and-bundles)).
The app runs from a **new profile, `next-app`**, so the default `web`
profile — and the in-box UI it boots — stays untouched. Publishing to
the npm registry avoids pnpm's git-install limitations (build scripts,
`allowBuilds`, workspace-protocol exposure).

## Decision

- The deliverable is a **published npm bundle package** (a workspace
  subpackage, not the repo root — ADR-0007): its manifest declares
  `dsh.bundle.patch` → `cordis.patch.yml`, and its name is scoped
  outside `@deepseek-ai/*` so installation-first resolution never
  shadows it with the in-box package.
- Installation: `dsh plugin --profile next-app add <pkg>` initializes
  the profile (`dsh.profile.bundles` = `["@deepseek-ai/dsh-base"]`),
  installs the package, and layers it; boot with
  `dsh --profile next-app`. The `web` profile is never modified, and
  `dsh web` keeps serving the in-box surface.
- The patch rides over `dsh-base`: it reuses the in-box host rows we
  keep (api-gateway, webserver, storage, workspace, projection cache,
  session-stats, directory picker, cordis-host-runner, agent-presets, …)
  by name, carries the same agent-plane disables the in-box web-app patch
  carries (those rows belong to agent presets), and drops the in-box
  browser roster entirely.
- The patch also ports the in-box web-app patch's surface-value rows
  verbatim (`system-prompt` persona, `hmr` disabled,
  `session-query-sqlite` in-memory, `tools` mode), and our server row
  takes over the model-facing surfaces the in-box web-runtime owns: the
  web-surface prompt section, the `DSH_WEB_URL` shell variable, and the
  URL line.
- The frontend is the Next.js app (ADR-0001), built as a workspace
  subpackage (`apps/web`); the bundle package's `prepack` builds it and
  packs the `.next` output into the published tarball — no committed
  build output.
- Our patch keeps the in-box `webserver` row — generic route
  infrastructure with no harness concepts, and hard-injected by the
  `directory-picker` row we keep — and replaces the
  web-runtime/frontend-static/connection rows with our own server row:
  a host plugin that mounts the Next.js app in custom-server mode as the
  webserver's fallback request handler, parses the same
  `--host/--port/--trusted-host` flags, and forwards `/api` to the
  gateway handler in-process.
- Rejected: git-hosted installs (pnpm build-script and
  workspace-protocol friction); replacing the default `web` profile
  (touches deployment-owned state while the two surfaces coexist fine
  side-by-side).

## Consequences

- Deployment is one command into a fresh profile plus a boot line;
  rollback is `dsh plugin --profile next-app remove <pkg>` (a real
  dependency, so reconciliation also drops it from the bundle list) or
  simply not booting the profile. The default `web` profile is never
  touched; the two surfaces coexist against the same `DSH_HOME` data,
  needing distinct ports when run simultaneously.
- The boot command differs from the in-box alias:
  `dsh --profile next-app` (the `web` alias is hardcoded to the `web`
  profile).
- We own the surface lifecycle — flags, routes, the server row — while
  the kept `webserver` row still owns bind, port resolution, and
  shutdown. Porting the surface patch layer across dsh upgrades joins
  the ADR-0006 diff drill; the in-box patch (MIT) is the porting source.
- Next.js runs in custom-server mode (its documented embedding point):
  `next` is a runtime dependency of the bundle, and `next start`-only
  optimizations (automatic static-optimization headers, built-in
  compression) are unavailable — the server row supplies caching headers
  and compression itself. RSC, SSR, and streaming are unaffected.
- The published tarball carries `cordis.patch.yml`, the `lib/` glue, and
  the built frontend output (`files` field); `next`, `react`,
  `react-dom`, and pure-JS helpers are its only runtime dependencies —
  the in-box host packages are peerDependencies resolved from the user's
  dsh installation (ADR-0008) — so profile installs need no git, build
  scripts, or workspace resolution.
- Publishing breaks the in-box version lockstep (base comes from the
  user's dsh installation while our dependencies install into the
  profile): ADR-0008 decides the compatibility contract that keeps that
  drift loud instead of silent.
- In-box `dsh.client` client plugins do not run here — they need the
  client kernel we dropped.
- Development boots the `next-app` profile beside the in-box `web`
  profile, sharing `DSH_HOME`, so both surfaces show the same sessions
  side by side. Two processes sharing `DSH_HOME` is not dsh's
  multi-client case — storages are last-writer-wins and per-session logs
  can interleave — so development treats the shared home as read-mostly.
