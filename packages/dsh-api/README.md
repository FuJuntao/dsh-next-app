# dsh-api

Typed client for the dsh `/api` gateway protocol (deepseek-harness
`0.1.0-rc.7`): one tested, version-pinned surface for every call toward the
gateway — unary RPCs and the two SSE event downlinks — instead of raw fetch
calls scattered across the app. Isomorphic: usable from server components and
the browser chat island alike.

`dsh-api` is an internal pnpm workspace member (ADR-0007): it is not itself
published, and the published bundle (`dsh-next-app`) must not import it. Its
sole runtime dependency is `@deepseek-ai/dsh-host-apiproxy`, exact-pinned to
`0.1.0-rc.7` (ADR-0006); a test asserts that the built output's
`@deepseek-ai/*` runtime imports are exactly that one package.

## Exports

- **Values:** `createDshClient`, `ConnectionController`, `TrustFenceError`,
  `SUPPORTED_DSH_VERSION`, `assertDshVersion`, `hostFrameSchema`,
  `muxFrameSchema`
- **Types:** `DshTransport`, `ConnectionConfig`, `ConnectionSinks`,
  `ConnectionState`, `HostDescription`, plus the re-exported domain tree
  below

## createDshClient

One factory, explicit transport — never sniffed at runtime:

```ts
import { createDshClient } from "dsh-api";

const client = createDshClient({ transport: "browser" });
```

- **`"browser"`** — same-origin streaming fetch against the `/api` gateway.
  The base URL is the page's own origin (`location.origin`), so the gateway
  must be served at the app's origin; there is no endpoint configuration. Unary
  calls POST to `/api/<method>`; the streams open at `/api/events.mux` and
  `/api/events.host`. Streaming fetch per ADR-0003 — never `EventSource`,
  never WebSocket.
- **`{ handler }`** — an injected in-process `{ fetch: typeof fetch }`
  FetchHandler (server components, tests). Rides upstream's
  `InProcessApiClient`; never touches the network.
- Anything else throws `TypeError` at construction time.

Both variants are upstream `AbstractApiClient` subclasses over the same
`doFetch` seam, with the trust fence applied at the edge (see the error
taxonomy below).

The factory returns `IApiClient`, the payload-direct consumption face: unary
methods take the business payload directly (the carrier mints the `rpcId` and
wraps the envelope) and return `RpcResponse<T>` whose `result` is the typed
`RpcResult<T>`; stream methods return lazy async iterables. An optional
`AbortSignal` rides as the last parameter of unary methods.

```ts
const response = await client.host.describe({});
if (response.result.ok) {
  console.log(response.result.value.version); // typed value
} else {
  console.error(response.result.error.code, response.result.error.message); // typed business error
}
```

```ts
// Injected: the handler answers in-process; this never touches the network.
const client = createDshClient({ transport: { handler: { fetch: myFetchHandler } } });
```

## Re-exported typed domain tree

From the upstream contract barrel `@deepseek-ai/dsh-host-apiproxy/api`
(re-exported as types): the per-domain Api interfaces and their payload/value
types (sessions, subagents, host, workspace, skills, agentPresets, goals,
settings, credentials, llm), the four-quadrant RPC envelope types
(`RpcMessage` = `ClientRequest | ServerResponse | ServerRequest |
ClientResponse`, plus `RpcRequest`/`RpcResponse`, `RpcResult`/`RpcError`,
`RpcId`), and the `MuxFrame`/`HostFrame` discriminated unions. From
`/client`: the `IApiClient` type.

As values, only the two frame schemas are re-exported —
`hostFrameSchema`/`muxFrameSchema` from `api/events.schema` (zod
discriminated unions, for parsing stream frames).

The value seams the client itself builds on (`AbstractApiClient`,
`InProcessApiClient`, `RpcId`, `transportError`) are deliberately **not**
re-exported; code that needs them imports directly from
`@deepseek-ai/dsh-host-apiproxy/client` or `/api`.

## ConnectionController

Dual-stream connect/pump/reconnect loop. Ported with attribution from
`@deepseek-ai/dsh-client-connection` `0.1.0-rc.7` (MIT — upstream does not
export it at its package boundary; the port keeps the same contract and loop
semantics, see the source header for the license text).

```ts
import { ConnectionController, createDshClient } from "dsh-api";

const controller = new ConnectionController(createDshClient({ transport: "browser" }), {
  onConnected(description) {
    // After each generation: both streams open + host.describe succeeded.
    // Frames carry no id: and 'since' is unimplemented upstream — re-baseline
    // here via unary calls (session.list, workspace.list); frame delivery is
    // never blocked on it.
  },
  onStateChange(state) {
    // "connected" | "reconnecting", deduplicated. Nothing fires before the
    // first connect: no state yet = connecting, not an outage.
  },
  onMuxEnvelope(envelope) {
    /* RpcRequest<MuxFrame> — business dispatch */
  },
  onHostEnvelope(envelope) {
    /* RpcRequest<HostFrame> — business dispatch */
  },
});
controller.start(); // idempotent
// ... later:
controller.stop(); // aborts the current generation's streams
```

`ConnectionSinks`:

- `onMuxEnvelope` / `onHostEnvelope` — frame envelopes; the controller owns
  the physical streams, business dispatch belongs to the consumer.
- `onConnected(description: HostDescription)` — after each established
  connection generation (first connect included); `HostDescription` is
  `ResponseValue<"host.describe">`.
- `onStateChange(state)` — coarse deduplicated state transitions.

`ConnectionConfig` (all optional; defaults shown):

| Option | Default | Meaning |
| --- | --- | --- |
| `backoffBaseMs` | `500` | First-retry backoff cap; the actual delay is jittered to cap/2..cap |
| `backoffFactor` | `2` | Exponential growth factor per consecutive failed attempt |
| `backoffMaxMs` | `10_000` | Upper bound for the backoff cap |
| `streamOpenTimeoutMs` | `3_000` | Cap on waiting for both streams' `onOpen` before `onConnected` |

Loop guarantees:

- Stream loss ⇒ resubscribe with jittered exponential backoff; repeated loss
  keeps the loop in `reconnecting` with growing backoff — never throws out of
  the loop.
- No re-baseline fetches: the controller never refetches history, and it does
  not block frame delivery while the consumer re-syncs.
- Heartbeat lines, whatever their SSE representation, are skipped upstream —
  never yielded, never stream-killing.
- Sink exceptions are isolated: a throwing business sink is logged, never
  affecting the pump or reconnect semantics.

## Error taxonomy

Three channels, never mixed:

| What failed | Where it surfaces |
| --- | --- |
| 401/403 at the transport edge (unary or stream-open) | throws `TrustFenceError` |
| Other HTTP non-ok, network error (unary) | throws the upstream transport error (foldable via `transportError()`) |
| Business refusal (unary) | returns normally, `RpcResult` error slot |
| Stream loss mid-stream | iterable ends/throws; `ConnectionController` converts it to `reconnecting` + backoff |

1. **`TrustFenceError`** (dsh-api) — the gateway answers 401/403 when basic
   auth credentials are missing or refused (ADR-0004). Both legs funnel through
   the `doFetch` seam, so one check maps those statuses to a thrown
   `TrustFenceError` with `.status: 401 | 403` and `.url` — check
   `instanceof TrustFenceError` and turn it into a login prompt instead of an
   opaque transport failure. Mid-stream revocation is unreachable: statuses
   only arrive at open time, and every reconnect re-hits the fence.
2. **Transport failures** (upstream) — any other carrier failure propagates as
   the upstream thrown error: `transport failure for <path>: HTTP <status>`
   for non-ok responses (e.g. 500), or the raw fetch rejection for network
   errors. Upstream's `transportError(error)` helper (a value import from
   `@deepseek-ai/dsh-host-apiproxy/api`, not re-exported here) folds such an
   error into the `RpcResult` error branch with code `internal` — the
   unified catch-all when you want to return instead of throw.
3. **Business errors** (typed `RpcResult` slot) — unary methods never throw
   business errors: a refusal returns normally with `result.ok === false` and
   `error: { code, message, details }`, where `code` is the closed
   `RpcErrorCode` union.

## Version pin

- `SUPPORTED_DSH_VERSION` — the single dsh version this release is tested
  against (currently `"0.1.0-rc.7"`).
- `assertDshVersion(actual)` — boot invariant (ADR-0008): fails loudly on a
  mismatch instead of quietly corrupting rendering.
- Bump drill (ADR-0006): bump dsh → run contract tests → diff the installed
  `.d.ts` schemas → update this pin, the root README, and regenerate the wire
  fixtures in the same change.

## Testing

- `pnpm build` first: the runtime-imports guard scans `dist/` and asserts
  the sole `@deepseek-ai/*` runtime import is `dsh-host-apiproxy`.
- `pnpm test` runs the vitest suites with no live host: factory, transports,
  trust fence, and connection semantics against scripted fakes, plus
  wire-replay suites against golden transcripts captured from a scratch-booted
  host — see `fixtures/wire/README.md` for the provenance model and
  `scripts/capture-wire-transcripts.mjs` to regenerate after a dsh bump.
- `pnpm lint` as usual.
