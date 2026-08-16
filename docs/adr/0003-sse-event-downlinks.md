# ADR-0003: SSE event downlinks instead of WebSocket

Status: Accepted

Date: 2026-08-16

## Context

dsh's in-box client uses WebSocket downlinks (`/api/events.mux`,
`/api/events.host`). When the UI sits behind HTTP basic auth — as this
app does by design (ADR-0004) — WebKit browsers (iOS Safari, all iOS
browsers) do not attach Basic Auth credentials to WebSocket handshakes,
so the downlinks 401 and the app never connects.

## Decision

The new app uses **SSE for event downlinks from day one** (streaming fetch
with credentials), keeping fetch JSON-RPC for requests. SSE responses are
already how the gateway streams RPC bodies, so this is native behavior,
not a workaround.

## Consequences

- Basic-auth interop works on every browser with zero special cases; the
  whole WebKit-WebSocket class of problems disappears.
- Downlinks are one-way (fine: requests are ordinary fetch calls). The
  gateway's SSE frames carry no `id:` events, so resume is resubscribe +
  re-sync against the projection cache — not last-event-id; `dsh-api`
  owns reconnect with backoff.
- The stream is silent while the host is idle: the downlink bridge sends
  heartbeats and sets `x-accel-buffering: no` so proxies neither buffer
  nor idle out the stream.
- No WebSocket server or client code in this app at all.
