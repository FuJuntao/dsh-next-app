# ADR-0010: Unix-socket bridge over the shipped fetch carrier

Status: Accepted

Date: 2026-08-26

## Context

ADR-0003 decided the parent/child envelope bridge speaks NDJSON frames over
one multiplexed unix-socket connection: the runtime row and the app each
implement the framing, the two-level parse, and a pending table keyed by
rpcId. Implementing the unary slice (story #107 task #108) showed that the
shipped gateway package (the profile's pinned `@deepseek-ai/dsh-host-apiproxy`)
already carries the complete carrier pair the bridge needs: the fetch
handler (`toFetchHandler`) on the host side - two-level parse with the
pinned zod schemas, method dispatch, `ServerResponse` replies, bad-request
errors - and the abstract client (`AbstractApiClient`) on the client side -
rpcId minting, envelope wrap/unwrap, per-method value validation, per-request
timeouts. Maintaining a second, bespoke framing of the same protocol in the
bundle duplicated that contract surface for no benefit: every method the
bridge wanted required a new route row mirroring the shipped handler's, and
every validation the client performed mirrored the shipped client's.

## Decision

The bridge reuses the shipped fetch carrier over the same mode-0600 unix
socket. ADR-0003's socket lifecycle and security model are unchanged (path
under the profile run directory, stale-socket replace at boot, chmod 0600,
unlink on stop, path forwarded to the child via environment):

- **Framing is HTTP over the socket**: the runtime row binds a Node HTTP
  server to the socket path and adapts `IncomingMessage`/`ServerResponse`
  onto the WHATWG `Request`/`Response` pair around `toFetchHandler(apiProxy)`;
  the app extends `AbstractApiClient` with a `doFetch` that speaks to the
  socket via `node:http` `socketPath`. The envelope messages remain the
  wire contract - a unary call is a `POST /api/<method>` whose body is a
  `ClientRequest`, answered by a `ServerResponse` body.
- **Each unary call is its own connection**; ADR-0003's single multiplexed
  rpc connection and pending table are superseded - the transport correlates
  requests itself.
- **The bridge defines no routes**: the method dispatch, the per-method
  payload schemas, and the bad-request replies live in the shipped handler,
  so every unary method the gateway serves is available to the app without a
  bundle change, and payload-shape drift still fails loud with a
  bad-request envelope at the bridge. Unknown methods answer HTTP 404 (the
  carrier's not-found), like the in-box gateway over its webserver.
- **Downlink routes** (`events.mux`/`events.host` SSE) are served by the
  same handler when the downlink story lands; the row's per-request timeout
  applies to unary POSTs only, never to streams.
- The client's reconnect-with-backoff (ADR-0003) is superseded: each call is
  a fresh connection attempt, so the bridge-down state is a refused connect
  per request.

Supersedes: ADR-0003's framing paragraph (NDJSON), its connection-model
paragraph (one multiplexed rpc connection with a pending table), its
client-side reconnect-with-backoff clause, and the consequence describing
the bespoke ~400-line bridge surface.

## Consequences

- The bespoke bridge surface shrinks to two thin transport adapters - an
  HTTP-server adapter on the row and a socket transport on the client -
  instead of a bespoke protocol implementation; the protocol lives in the
  shipped, catalog-pinned package (ADR-0006), where the gateway's own tests
  cover it.
- Version-drift protection is unchanged in strength: the shipped handler and
  client validate the same pinned schemas on both ends, so a host bump that
  changes the envelope or a method's payload/value shape fails loud at the
  bridge.
- New unary methods need no bridge changes; app code consumes them through
  the standard `IApiClient` domain face.
- The e2e bridge contract pins the served surface (socket mode, round-trip,
  404, bad-request, 400) and the socket filename, like the ready-marker spec
  pins the ready line.
