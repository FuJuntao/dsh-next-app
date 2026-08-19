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
   re-exporting its typed domain tree and importing its frame schemas
   (`dsh-host-apiproxy/api/events.schema`); `dsh-host-apiproxy` is the only
   upstream runtime dependency, exact-pinned to `0.1.0-rc.7`, and a test
   asserts the built output's `@deepseek-ai/*` runtime imports are exactly
   that one package.
2. One factory, `createDshClient({ transport })`, takes an explicit transport
   - `'browser'` (same-origin streaming fetch to `/api`) or `{ handler }`
   (injected in-process FetchHandler) - with no runtime sniffing; both ride the
   `doFetch` seam, streaming fetch per ADR-0003 (never `EventSource`, never
   WebSocket).
3. The client drives the two streams through the ported upstream connection
   loop (`ConnectionController`, same `ConnectionSinks`/`ConnectionConfig`
   contract): resubscribe on stream loss with jittered exponential backoff,
   deduplicated `connected | reconnecting` state (no state yet = connecting),
   and an `onConnected(hostDescription)` signal after each generation's
   mux+host+describe handshake; it performs no re-baseline fetches and does
   not block frame delivery while the consumer re-syncs (frames carry no
   `id:`; `since` is unimplemented upstream - re-baselining is the consumer's
   unary-call job). Heartbeat lines, whatever their SSE representation, are
   skipped - never yielded, never stream-killing.
4. A `TrustFenceError` surfaces 403/401 at the transport edge; transport
   failures stay upstream `transportError`; business errors stay in the typed
   `RpcResult` error slot; repeated stream loss keeps the loop in
   `reconnecting` with growing backoff (the ported controller's semantics)
   rather than throwing or terminating.
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
- No projection cache or UI state in the client - consumers re-baseline on
  `onConnected`; no Cordis client-kernel mount (`apply`, `ctx.connection`,
  `ctx.remote`) - the app stays outside the in-box client composition
  (ADR-0001, ADR-0002); no WebSocket anywhere (ADR-0003).
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
- The transports are small subclasses over upstream seams: the browser
  transport supplies `doFetch` and opens both streams via the protected
  `readSse`; the injected side reuses upstream `InProcessApiClient`.
- Reconnect/backoff is the upstream loop ported, not re-invented:
  `ConnectionController` (`dsh-client-connection`, MIT) is
  transport-agnostic but not exported at the package boundary, so dsh-api
  ports it with attribution, keeping the same `ConnectionSinks`/
  `ConnectionConfig` contract - porting in-box code is already the repo's
  sanctioned pattern (ADR-0002).
- `dsh-host-apiproxy` is a host package: peerDependency of the published
  bundle per ADR-0008; the internal member declares it as its dependency so the
  workspace links it; `zod` enters only through upstream's code.
- The boot-glue story still performs its own readiness `host.describe` with
  upstream primitives - ADR-0007 forbids the bundle importing `dsh-api`; the
  app-side handshake ships with the ported loop.

## Priority

High - the chat UI, auth, and contract-test stories all build on it.
