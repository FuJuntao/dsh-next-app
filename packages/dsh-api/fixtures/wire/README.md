# Golden wire transcripts

JSONL fixtures replayed by `src/wire-replay.test.ts` - the wire facts the
`dsh-api` client covers (AC 6 of issue #39), recorded by
`scripts/capture-wire-transcripts.mjs` against a scratch-booted dsh host
(isolated `DSH_HOME`, never the shared `~/.dsh`; no credentials configured at
capture time, so nothing secret-shaped can appear here - the replay suite
asserts that).

Each file opens with a `meta` record naming the dsh version the transcripts
were captured against; the replay suite fails when it drifts from
`src/version.ts`'s `SUPPORTED_DSH_VERSION`. Regenerate after a dsh bump as
part of the upgrade drill (ADR-0006):

    node packages/dsh-api/scripts/capture-wire-transcripts.mjs

## Files

- `unary.jsonl` - the four-quadrant envelope over HTTP: client-request →
  server-response (ok values, typed business errors, invalid envelopes),
  carrier statuses (not RpcMessages), and the client-response → receipt leg.
- `streams.jsonl` - event-downlink facts: frames captured live from the
  in-box WebSocket downlinks, SSE transcripts produced by the pinned
  upstream emitter around those frames, the stream/error failure path, and
  the non-frame (heartbeat/comment) lines.
- `trust.jsonl` - trust-fence transcripts: live 403 refusals (unary,
  stream-open, raw WebSocket-upgrade) and mock-edge 401s (the rc.7 host
  emits no 401; that status belongs to this app's basic-auth gate,
  ADR-0004).

Every record carries a `provenance` field: `live-http`, `live-ws-downlink`,
`live-raw-socket`, `upstream-emitter+live-frames`, `mock-edge`, or
`captured+synthetic` - see the capture script's header for what each means.
