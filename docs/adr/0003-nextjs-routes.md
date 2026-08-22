# ADR-0003: Next.js routes — app routes and /api over the unix-socket bridge

Status: Accepted

Date: 2026-08-16 (updated 2026-08-21)

## Context

The surface (ADR-0001) has two route families: app routes (pages, the
shell, the chat island, live streams) and `/api` (Next-native handlers
implementing the gateway's capabilities). `/api` must be served by
Next — the single public surface behind the auth fence — but
implemented by dsh's gateway services, which live in the dsh process.
The two processes are parent and child, so no HTTP listener is needed
between them.

## Decision

- **App routes**: pages, RSC, and static assets per ADR-0001. Live
  surfaces stream over **SSE downlink routes** — streaming fetch with
  credentials; WebKit browsers do not attach Basic Auth credentials to
  WebSocket handshakes, so the browser-facing downlinks are SSE from
  day one. The app's downlink routes send heartbeats and set
  `x-accel-buffering: no`; frames carry no `id:` events, so resume is
  resubscribe + re-sync. No WebSocket code anywhere.
- **`/api` routes**: Next-native route handlers that relay over a
  **mode-0600 unix socket** under the profile's run directory. Stale
  socket files are replaced at boot and the socket is unlinked on
  stop; the child receives the path as an environment variable and
  reconnects with backoff whenever the socket drops.
- **Framing is NDJSON** — one JSON message per line (JSON.stringify
  never emits raw newlines). Messages are the existing envelope types
  (`ClientRequest` / `ServerResponse` / `ServerRequest`), validated
  with the pinned zod schemas on both ends.
- **One rpc connection** multiplexes unary calls through a pending
  table keyed by `rpcId`, with per-request timeouts; **each live
  downlink is its own connection**, so the framing needs no inner
  stream identifiers. The row dispatches unary frames to
  `apiProxy.respond()` and pumps `api.events.mux` / `api.events.host`
  as frames honoring write/drain backpressure; a disconnect aborts the
  pumped iterators.
- The basic-auth fence (ADR-0001) covers every route, including these.

## Consequences

- The bridge is bespoke infrastructure (~400 lines across the row and
  the app's socket client) with its own test surface: framing,
  multiplexing, backpressure, per-request timeouts, disconnect abort,
  child-restart reconnect, stale-socket handling.
- The boundary is total: no remote party can address the transport,
  and the envelope never reaches a network; version drift fails loud
  at the bridge, whose frames are validated with the pinned schemas.
- The gateway's HTTP trust fence is bypassed by construction; the
  socket's filesystem permissions are its access control.
