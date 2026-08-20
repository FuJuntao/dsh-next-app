# Implement the bundle runtime glue

- Date: 2026-08-20

As an operator of the `next-app` profile, I want the bundle's server row to
boot the built Next app on the profile's web server — bridging the host's mux
and host event downlinks to SSE with heartbeats, completing a readiness
`host.describe` handshake, and failing the boot loudly on a dsh version
mismatch — so that `dsh --profile next-app` serves the replacement surface
exactly as the README's install flow promises.

## Acceptance Criteria

1. `packages/dsh-next-app/cordis.patch.yml` declares the next-app rows — the
   startup row (a port of the in-box web-startup flag parsing, `--port` only,
   default 3080), the transport rows (`webserver`, `connection`,
   `api-gateway`), and the glue row — and `src/web-startup.ts` is a real
   implementation (no placeholder throw) that mounts the built Next handler as
   the webserver fallback and announces a URL line after the loader settles;
   `dsh --profile next-app` serves the app page at `/`.
2. The glue bridges the host's mux and host event downlinks to SSE at
   `/api/events.mux` and `/api/events.host` on the same origin, with
   transport-level heartbeats and `x-accel-buffering: no` (ADR-0003); no
   WebSocket server or client code anywhere in the bundle.
3. Boot performs a readiness `host.describe` with upstream primitives and logs
   the host description; a slow or failing describe never blocks serving (the
   app re-baselines on connect).
4. The bundle ships the `./invariant` companion: boot fails loudly when the
   running dsh version does not exactly match the pinned tested version; the
   pin is generated into the bundle at pack time from `dsh-api`'s
   `SUPPORTED_DSH_VERSION` — one source of truth, no hand-synced duplicate.
5. `prepack` builds `apps/web` and copies its output into the bundle, and
   `files` ships it; a packaging drill asserts the packed tarball contains
   `dsh.bundle.patch`, `cordis.patch.yml`, `lib/`, and the app build.
6. The bundle's `package.json` declares as `peerDependencies` the host
   packages its rows name (the ADR-0008 cross-cutting set plus
   `dsh-host-webserver`, `dsh-client-connection`, `dsh-host-apiproxy`); a test
   asserts the built bundle's runtime imports stay within {`next`, `react`,
   `react-dom`, own helpers, declared peerDependencies} and that `dsh-api` is
   never imported.
7. Automated tests drive the webserver service with a fixture Next build and
   assert the app page is served, the SSE bridge emits frames and heartbeats,
   and the invariant rejects a mismatched version; `pnpm build`, `pnpm test`,
   `pnpm lint` pass at the workspace root; the PR records a manual
   `dsh --profile next-app` boot walkthrough as verification evidence.

## Non-Goals

- No product surfaces in `apps/web` (chat island, session list, settings stay
  placeholder) — the UI stories' job; `dsh.bundle.patch` UI-layer content stays
  empty.
- No HTTP basic auth gate and no pre-built auth seam (ADR-0004 story) — see
  Technical Notes and Open Questions.
- No default-browser handoff (in-box `openBrowser` parity dropped; URL line
  only).
- No npm scope decision, publishing workflow, or release-per-dsh-bump
  pipeline (the publish story).
- No live-host contract tests (ADR-0006 story); no WebSocket anywhere
  (ADR-0003); no `dsh-api` import into the bundle (ADR-0007); the in-box
  `web` profile is untouched (ADR-0002).

## Technical Notes

- Reference implementation: `@deepseek-ai/dsh-web-app` (startup flag parsing →
  startup service; glue row injecting `webServer`, mounting the frontend via
  the fallback seat, announcing the URL line after `loader` settles);
  deployment-side plugins serving SSE variants of the event paths prove the
  bridge pattern. At dsh 0.1.0-rc.7 (the pinned version) the
  `dsh-client-connection` host half serves `/api` (HTTP RPC bridge + trust
  fence) and pumps the two event downlinks as WebSocket upgrades only — SSE
  bridging is the glue's job (ADR-0003).
- The patch declares only the base + transport rows plus the next-app startup
  and glue rows — not the in-box browser roster (client-ui rows, storage,
  directory pickers) the Next app does not consume.
- Porting in-box code with attribution is the repo's sanctioned pattern
  (ADR-0002; see the dsh-api story's `ConnectionController` port).
- ADR-0008: host packages are peerDependencies resolved from
  `$DSH_HOME/profiles/node_modules`; the invariant companion fails boot on
  version mismatch; the pin is pack-time generated from `dsh-api`'s constant.
- Inherited design task for the auth story: `/api` is owned by the
  `connection` row's trust fence, so the ADR-0004 basic-auth gate needs a
  standing place in front of it. Deferring the seam design keeps this glue
  minimal; this note records it so the cost is not lost.
- Readiness: the glue performs its own `host.describe` with upstream
  primitives; the app-side handshake ships with the dsh-api ported loop
  (client story).

## Priority

High — without it the README's install flow serves nothing; the auth and UI
stories build on it.

## Open Questions

- Where should the ADR-0004 basic-auth gate stand, given `/api` is owned by
  the `connection` row? Unresolved in the interview: defer the seam design to
  the auth story (recommended), or pre-build a forwarding seam now.
