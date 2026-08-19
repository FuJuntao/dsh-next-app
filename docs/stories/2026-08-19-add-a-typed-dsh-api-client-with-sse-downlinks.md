# Add a typed dsh-api client with SSE downlinks

- Date: 2026-08-19

As a developer building the app surfaces, I want a typed client in
`packages/dsh-api` for the dsh `/api` gateway protocol with SSE event
downlinks and reconnect/backoff usable from both server components and the
browser chat island, so that every call toward the gateway goes through one
tested, version-pinned surface instead of raw fetch calls scattered across the
app.

## Acceptance Criteria

1. `packages/dsh-api` exports an isomorphic typed client built on upstream
   `AbstractApiClient` (`@deepseek-ai/dsh-host-apiproxy/client`),
   re-exporting its typed domain tree; `dsh-host-apiproxy` is the only
   upstream runtime dependency, exact-pinned to `0.1.0-rc.7`, and a test
   asserts the built output's `@deepseek-ai/*` runtime imports are exactly
   that one package.
2. One factory, `createDshClient({ transport })`, takes an explicit transport
   - `'browser'` (same-origin streaming fetch to `/api`) or `{ handler }`
   (injected in-process FetchHandler) - with no runtime sniffing; both ride the
   `doFetch` seam, streaming fetch per ADR-0003 (never `EventSource`, never
   WebSocket).
3. The client wraps the `events.mux`/`events.host` streams with reconnect =
   resubscribe + re-sync, exponential backoff with jitter, and a typed
   connection state (`connecting | connected | reconnecting | failed`) plus a
   per-stream re-sync signal; it performs no re-baseline fetches and does not
   block frame delivery while the consumer re-syncs (frames carry no `id:`;
   `since` is unimplemented upstream - re-baselining is the consumer's
   unary-call job). Heartbeat lines, whatever their SSE representation, are
   skipped - never yielded, never stream-killing.
4. A `TrustFenceError` surfaces 403/401 at the transport edge; transport
   failures stay upstream `transportError`; business errors stay in the typed
   `RpcResult` error slot; reconnect exhaustion is a `failed` state event,
   not a thrown error.
5. The existing version-pin exports (`SUPPORTED_DSH_VERSION`,
   `assertDshVersion`) are untouched and all their tests still pass.
6. Vitest suites encode every documented fact this client covers - envelope
   quadrants, SSE framing, frame vocabulary, heartbeat skipping, trust-error
   mapping, backoff behavior - against recorded golden wire transcripts (JSONL
   fixtures captured by a committed capture script); no live host required to
   run tests.
7. `pnpm build`, `pnpm test`, `pnpm lint` pass at the workspace root; the
   client's public surface is documented (ADR-0005).

## Non-Goals

- No implementation of the host/impl face (`ApiProxy` business methods) - the
  kept host assembly owns those (ADR-0002).
- No `/api` forwarding, downlink bridge, or heartbeat production - that's the
  server row in the bundle glue (`web-startup`), the boot-glue story's job.
- No projection cache or UI state in the client - consumers own re-baselining;
  no Cordis/`dsh-api-gateway` adoption (`ctx.remote`); no WebSocket
  anywhere (ADR-0003).
- No readiness handshake (`host.describe` on connect) - the boot-glue story
  wires it.
- No chat UI, UI projection layer, or browser-to-app routes; no live-host
  contract tests (separate ADR-0006 story); no HTTP basic auth gate (ADR-0004
  story); no changes to `web-startup` or the bundle manifest, and nothing
  imports `dsh-api` into `packages/dsh-next-app` (ADR-0007).

## Technical Notes

- Facts pinned against dsh `0.1.0-rc.7`: envelope, RPC method map, and frame
  schemas live in `dsh-host-apiproxy/api`; event payloads in
  `dsh-session/types`, `dsh-llm/types`.
- The frame vocabulary carries no heartbeat frame; the bridge's heartbeats are
  transport-level, and upstream's `readSse` already skips non-frame lines.
  Reconnect facts are documented upstream: "reconnection = reopen the stream +
  refetch history"; `session.list`/`workspace.list` provide reconnect
  baselines.
- `dsh-host-apiproxy` is a host package: peerDependency of the published
  bundle per ADR-0008; the internal member declares it as its dependency so the
  workspace links it; `zod` enters only through upstream's code.
- Reconnect policy is ours alone: upstream's in-box app gets stream rebuilds
  from Connection's generation controller, which we deliberately don't mount.

## Priority

High - the chat UI, auth, and contract-test stories all build on it.
