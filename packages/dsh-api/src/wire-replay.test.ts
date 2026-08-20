import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectionController,
  SUPPORTED_DSH_VERSION,
  TrustFenceError,
  createDshClient,
  hostFrameSchema,
  muxFrameSchema,
} from "./index.js";

/**
 * Golden wire transcript replay (AC 6, issue #43): every documented fact this
 * client covers - envelope quadrants, SSE framing, frame vocabulary,
 * heartbeat skipping, trust-error mapping, backoff behavior - replayed
 * through the real client, the real frame schemas, and the real connection
 * loop against the fixtures committed beside this suite
 * (fixtures/wire/*.jsonl, recorded by scripts/capture-wire-transcripts.mjs
 * against a scratch-booted dsh host). No live host, no network.
 */

const fixturesDir = fileURLToPath(new URL("../fixtures/wire/", import.meta.url));

// ---- record shapes ----------------------------------------------------------

interface WireMeta {
  kind: "meta";
  dshVersion: string;
  capturedAt: string;
  host?: { describeValue?: unknown; note?: string };
  note?: string;
}

interface WireRequest {
  method: string;
  path: string;
  contentType?: string;
  hostHeader?: string;
  upgrade?: string;
  body?: string;
}

interface WireResponse {
  status: number;
  contentType: string | null;
  headers?: Record<string, string>;
  body: string;
}

interface UnaryRecord {
  kind: "unary" | "carrier" | "respond";
  name: string;
  quadrant?: string;
  result?: string;
  provenance: string;
  request: WireRequest;
  response: WireResponse;
}

interface SseRecord {
  kind: "sse";
  name: string;
  stream: "mux" | "host";
  provenance: string;
  response: { status: number; contentType: string | null };
  raw: string;
  frames: { rpcId: string; payload: unknown }[];
  note?: string;
}

interface WsFramesRecord {
  kind: "ws-frames";
  name: string;
  stream: string;
  provenance: string;
  frames: { type: string; rpcId: string; method: string; payload: { type: string } }[];
  note?: string;
}

interface HeartbeatsRecord {
  kind: "heartbeats";
  name: string;
  provenance: string;
  captured: string[];
  syntheticBridge: string[];
  note?: string;
}

interface TrustRecord {
  kind: "trust";
  name: string;
  leg: "unary" | "stream-open" | "ws-upgrade";
  status: number;
  provenance: string;
  request: WireRequest;
  response?: WireResponse;
  raw?: string;
}

function loadRecords(file: string): unknown[] {
  const text = readFileSync(path.join(fixturesDir, file), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

const unaryFile = loadRecords("unary.jsonl");
const streamsFile = loadRecords("streams.jsonl");
const trustFile = loadRecords("trust.jsonl");

function byName<T>(records: unknown[], name: string): T {
  const record = records.find((candidate) => (candidate as { name?: string }).name === name);
  if (record === undefined) throw new Error("fixture record missing: " + name);
  return record as T;
}

function metasOf(records: unknown[]): WireMeta[] {
  return records.filter((record) => (record as { kind?: string }).kind === "meta") as WireMeta[];
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function injectedClient(fetchImpl: FetchFn) {
  return createDshClient({ transport: { handler: { fetch: fetchImpl } } });
}

function responseOf(record: UnaryRecord | TrustRecord): Response {
  const response = record.response;
  if (response === undefined)
    throw new Error("record has no fetch-replayable response: " + record.name);
  const headers = new Headers();
  if (response.contentType !== null && response.contentType !== undefined) {
    headers.set("content-type", response.contentType);
  }
  for (const [key, value] of Object.entries(response.headers ?? {})) headers.set(key, value);
  return new Response(response.body === "" ? null : response.body, {
    status: response.status,
    headers,
  });
}

/**
 * The host's echo invariant: a server-response always carries the rpcId of
 * the client-request it answers. The captured bodies carry the capture-time
 * id, so a faithful replay rewrites it to the replayed request's id - every
 * other byte passes through verbatim.
 */
function echoingResponseOf(record: UnaryRecord, init?: RequestInit): Response {
  const response = record.response;
  const headers = new Headers();
  if (response.contentType !== null && response.contentType !== undefined) {
    headers.set("content-type", response.contentType);
  }
  for (const [key, value] of Object.entries(response.headers ?? {})) headers.set(key, value);
  let text = response.body;
  try {
    const requestEnvelope = JSON.parse(typeof init?.body === "string" ? init.body : "") as {
      rpcId?: unknown;
    };
    const responseEnvelope = JSON.parse(response.body) as { type?: string; rpcId?: string };
    if (typeof requestEnvelope.rpcId === "string" && responseEnvelope.type === "server-response") {
      responseEnvelope.rpcId = requestEnvelope.rpcId;
      text = JSON.stringify(responseEnvelope);
    }
  } catch {
    // non-JSON carrier bodies (415/404, receipts) pass through verbatim
  }
  return new Response(text === "" ? null : text, { status: response.status, headers });
}

/** Frame payloads carried by raw SSE bytes (includes the stream/error frame). */
function dataPayloadsOf(raw: string): unknown[] {
  const payloads: unknown[] = [];
  for (const event of raw.split("\n\n")) {
    if (event === "") continue;
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6))
      .join("");
    if (data === "") continue;
    payloads.push((JSON.parse(data) as { payload: unknown }).payload);
  }
  return payloads;
}

/** Handler answering with the recorded response and capturing what the client sends. */
function recordingHandler(record: UnaryRecord | TrustRecord): {
  handler: FetchFn;
  seen: { url: string; method: string | undefined; contentType: string | null; body: string }[];
} {
  const seen: {
    url: string;
    method: string | undefined;
    contentType: string | null;
    body: string;
  }[] = [];
  const handler: FetchFn = async (input, init) => {
    const body = init?.body;
    seen.push({
      url: String(input),
      method: init?.method,
      contentType: new Headers(init?.headers).get("content-type"),
      body: typeof body === "string" ? body : "",
    });
    if (record.kind === "trust") return responseOf(record);
    return echoingResponseOf(record, init);
  };
  return { handler, seen };
}

// ---- fixture meta -----------------------------------------------------------

describe("fixture meta", () => {
  it("every file is captured against the pinned dsh version (ADR-0006 drill)", () => {
    for (const meta of [...metasOf(unaryFile), ...metasOf(streamsFile), ...metasOf(trustFile)]) {
      expect(meta.dshVersion).toBe(SUPPORTED_DSH_VERSION);
    }
  });
});

// ---- envelope quadrants -------------------------------------------------------

describe("envelope quadrants", () => {
  const okCalls: {
    name: string;
    call: (client: ReturnType<typeof injectedClient>) => Promise<unknown>;
  }[] = [
    { name: "host-describe-ok", call: (client) => client.host.describe({}) },
    { name: "session-list-ok", call: (client) => client.sessions.list({}) },
    { name: "workspace-list-ok", call: (client) => client.workspace.list({}) },
    { name: "session-create-ok", call: (client) => client.sessions.create({}) },
  ];

  it.each(okCalls)(
    "$name: client-request out, server-response in (ok quadrant)",
    async ({ name, call }) => {
      const record = byName<UnaryRecord>(unaryFile, name);
      const capturedRequest = JSON.parse(record.request.body ?? "") as {
        type: string;
        rpcId: string;
        method: string;
        payload: unknown;
      };
      const capturedResponse = JSON.parse(record.response.body) as {
        type: string;
        rpcId: string;
        result: unknown;
      };
      const { handler, seen } = recordingHandler(record);
      const client = injectedClient(handler);

      const response = (await call(client)) as { rpcId: string; result: unknown };

      // server-response quadrant: the captured bytes parse into the typed result,
      // and the captured transcript itself shows the rpcId echo invariant
      expect(capturedResponse.type).toBe("server-response");
      expect(capturedResponse.rpcId).toBe(capturedRequest.rpcId);
      expect(response.result).toStrictEqual(capturedResponse.result);

      // client-request quadrant: what the client actually put on the wire matches
      // the captured envelope shape (rpcId is client-minted, compared by type)
      expect(seen).toHaveLength(1);
      const sent = seen[0];
      if (sent === undefined) throw new Error("no request captured");
      expect(sent.method).toBe("POST");
      expect(new URL(sent.url).pathname).toBe(record.request.path);
      expect(sent.contentType).toBe("application/json");
      const sentEnvelope = JSON.parse(sent.body) as {
        type: string;
        rpcId: unknown;
        method: string;
        payload: unknown;
      };
      expect(sentEnvelope.type).toBe("client-request");
      expect(typeof sentEnvelope.rpcId).toBe("string");
      expect(sentEnvelope.method).toBe(capturedRequest.method);
      expect(sentEnvelope.payload).toStrictEqual(capturedRequest.payload);
      // the replayed echo satisfies the client's rpcId verification
      expect(response.rpcId).toBe(sentEnvelope.rpcId);
    },
  );

  it("business errors stay in the typed RpcResult error slot (never thrown)", async () => {
    const record = byName<UnaryRecord>(unaryFile, "session-create-agent-preset-not-found");
    const capturedResult = (
      JSON.parse(record.response.body) as { result: { ok: boolean; error: unknown } }
    ).result;
    const { handler } = recordingHandler(record);
    const client = injectedClient(handler);

    const response = await client.sessions.create({ agentPreset: "no-such-preset" });

    expect(response.result).toStrictEqual({
      ok: false,
      error: (capturedResult as { error: unknown }).error,
    });
    if (response.result.ok) throw new Error("expected the error branch");
    expect(response.result.error.code).toBe("agent-preset-not-found");
  });

  it.each(["invalid-envelope-missing-fields", "invalid-envelope-rpc-id-not-string"])(
    "%s: the host answers invalid envelopes with a bad-request result (wire fact)",
    (name) => {
      // The real client never sends an invalid envelope, so this transcript is
      // asserted as captured bytes: garbage in, still a well-formed
      // server-response with the sentinel rpcId out (HTTP stays 200).
      const record = byName<UnaryRecord>(unaryFile, name);
      const capturedResponse = JSON.parse(record.response.body) as {
        type: string;
        rpcId: string;
        result: {
          ok: boolean;
          error: { code: string; message: string; details: { issues: unknown[] } };
        };
      };
      expect(record.response.status).toBe(200);
      expect(capturedResponse.type).toBe("server-response");
      expect(capturedResponse.rpcId).toBe("invalid-request");
      expect(capturedResponse.result.ok).toBe(false);
      expect(capturedResponse.result.error.code).toBe("bad-request");
      expect(capturedResponse.result.error.details.issues.length).toBeGreaterThan(0);
    },
  );

  it.each([
    { name: "unsupported-content-type", status: 415 },
    { name: "unknown-path", status: 404 },
  ])("$name: carrier statuses stay upstream transport failures", async ({ name, status }) => {
    const record = byName<UnaryRecord>(unaryFile, name);
    const { handler } = recordingHandler(record);
    const client = injectedClient(handler);

    const error = await client.host.describe({}).catch((thrown: unknown) => thrown);

    expect(error).not.toBeInstanceOf(TrustFenceError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP " + String(status));
  });

  it("client-response quadrant: respond echoes the rpcId and yields the carrier receipt", async () => {
    const record = byName<UnaryRecord>(unaryFile, "respond-not-pending");
    const capturedRequest = JSON.parse(record.request.body ?? "") as {
      type: string;
      rpcId: string;
    };
    const capturedReceipt = JSON.parse(record.response.body) as unknown;
    const { handler, seen } = recordingHandler(record);
    const client = injectedClient(handler);

    const receipt = await client.respond(
      capturedRequest as unknown as Parameters<ReturnType<typeof injectedClient>["respond"]>[0],
    );

    expect(receipt).toStrictEqual(capturedReceipt);
    expect(receipt).toStrictEqual({ accepted: false, reason: "not-pending" });
    const sent = seen[0];
    if (sent === undefined) throw new Error("no request captured");
    expect(new URL(sent.url).pathname).toBe("/api/respond");
    const sentEnvelope = JSON.parse(sent.body) as { type: string; rpcId: string };
    expect(sentEnvelope.type).toBe("client-response");
    expect(sentEnvelope.rpcId).toBe(capturedRequest.rpcId);
  });
});

// ---- SSE framing ----------------------------------------------------------------

describe("SSE framing", () => {
  const sseRecords = streamsFile.filter(
    (record) => (record as { kind?: string }).kind === "sse",
  ) as SseRecord[];

  it("captures exist for both streams and the failure path", () => {
    expect(sseRecords.map((record) => record.name).sort()).toStrictEqual([
      "events-host",
      "events-mux",
      "events-mux-stream-error",
    ]);
  });

  it.each(sseRecords.filter((record) => record.name !== "events-mux-stream-error"))(
    "$name: raw bytes carry the documented framing",
    (record) => {
      expect(record.response.status).toBe(200);
      expect(record.response.contentType).toBe("text/event-stream");
      // greeting comment first, events separated by a blank line
      expect(record.raw.startsWith(": connected\n\n")).toBe(true);
      const events = record.raw.split("\n\n").filter((event) => event !== "");
      for (const event of events) {
        const lines = event.split("\n");
        for (const line of lines) {
          expect(line.startsWith("data: ") || line.startsWith(": ")).toBe(true);
        }
      }
      const dataLines = events.filter((event) =>
        event.split("\n").some((line) => line.startsWith("data: ")),
      );
      expect(dataLines).toHaveLength(record.frames.length);
    },
  );

  it.each(sseRecords.filter((record) => record.name !== "events-mux-stream-error"))(
    "$name: the real client yields exactly the captured frames",
    async (record) => {
      const client = injectedClient(
        async () =>
          new Response(record.raw, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          }),
      );
      const signal = new AbortController().signal;
      const frames: unknown[] = [];
      const stream =
        record.stream === "mux" ? client.events.mux({}, signal) : client.events.host({}, signal);
      for await (const frame of stream) frames.push(frame);
      expect(frames).toStrictEqual(record.frames);
    },
  );

  it("events-mux-stream-error: one stream/error frame closes the stream", async () => {
    const record = byName<SseRecord>(streamsFile, "events-mux-stream-error");
    const client = injectedClient(
      async () =>
        new Response(record.raw, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const frames: { rpcId: string; payload: { type: string; error?: { code: string } } }[] = [];
    for await (const frame of client.events.mux({}, new AbortController().signal)) {
      frames.push(frame as { rpcId: string; payload: { type: string } });
    }
    const leading = frames.slice(0, record.frames.length);
    const trailing = frames.slice(record.frames.length);
    expect(leading).toStrictEqual(record.frames);
    expect(trailing).toHaveLength(1);
    const failure = trailing[0];
    if (failure === undefined) throw new Error("missing stream/error frame");
    expect(failure.payload.type).toBe("stream/error");
    expect(failure.payload.error?.code).toBe("internal");
  });
});

// ---- frame vocabulary -------------------------------------------------------------

describe("frame vocabulary", () => {
  const frameRecords = streamsFile.filter(
    (record) =>
      (record as { kind?: string }).kind === "ws-frames" ||
      (record as { kind?: string }).kind === "sse",
  ) as (WsFramesRecord | SseRecord)[];

  it("every captured frame parses under the pinned frame schemas, method echoes payload.type", () => {
    const observed = new Set<string>();
    let parsed = 0;
    for (const record of frameRecords) {
      // ws records carry full-form frames; sse payloads are read back from the
      // raw bytes so the emitter-added stream/error frame is covered too
      const payloads =
        record.kind === "ws-frames"
          ? record.frames.map((frame) => frame.payload)
          : dataPayloadsOf(record.raw);
      for (const payload of payloads) {
        const typed = payload as { type: string };
        observed.add(typed.type);
        const mux = muxFrameSchema.safeParse(payload);
        const host = hostFrameSchema.safeParse(payload);
        expect(mux.success || host.success).toBe(true);
        parsed += 1;
      }
      if (record.kind === "ws-frames") {
        for (const frame of record.frames) {
          // server-request quadrant: full form with method = payload.type
          expect(frame.type).toBe("server-request");
          expect(frame.method).toBe(frame.payload.type);
        }
      }
    }
    expect(parsed).toBeGreaterThan(0);
    // control + lifecycle frames captured from the fresh host, the enrichment
    // turn's session/host activity, and the emitter's failure frame
    expect(observed).toContain("session/subscribed");
    expect(observed).toContain("host/session-added");
    expect(observed).toContain("session/event");
    expect(observed).toContain("host/agent-error");
    expect(observed).toContain("stream/error");
  });
});

// ---- heartbeat skipping --------------------------------------------------------------

describe("heartbeat skipping", () => {
  it("captured and synthetic bridge heartbeat lines are never yielded, never stream-killing", async () => {
    const heartbeats = byName<HeartbeatsRecord>(streamsFile, "non-frame-lines");
    const mux = byName<SseRecord>(streamsFile, "events-mux");
    const commentBlocks = [...heartbeats.captured, ...heartbeats.syntheticBridge].map(
      (line) => line + "\n\n",
    );
    const interleaved =
      commentBlocks.join("") +
      mux.raw.replaceAll(
        "\n\n",
        "\n\n" + (heartbeats.syntheticBridge[0] ?? ": heartbeat") + "\n\n",
      );
    const client = injectedClient(
      async () =>
        new Response(interleaved, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const frames: unknown[] = [];
    for await (const frame of client.events.mux({}, new AbortController().signal))
      frames.push(frame);

    expect(frames).toStrictEqual(mux.frames);
  });
});

// ---- trust-error mapping --------------------------------------------------------------

describe("trust-error mapping", () => {
  const trustRecords = trustFile.filter(
    (record) => (record as { kind?: string }).kind === "trust",
  ) as TrustRecord[];

  it("captures cover live 403 (unary, stream-open, ws-upgrade) and mock-edge 401", () => {
    expect(trustRecords.map((record) => record.name).sort()).toStrictEqual([
      "stream-open-403-untrusted-host",
      "unary-401-bare",
      "unary-401-basic-auth-challenge",
      "unary-403-untrusted-host",
      "ws-upgrade-403-untrusted-host",
    ]);
    for (const record of trustRecords) {
      if (record.provenance.startsWith("live")) expect(record.status).toBe(403);
    }
  });

  it.each(trustRecords.filter((record) => record.response !== undefined && record.leg === "unary"))(
    "$name maps to TrustFenceError on the unary leg",
    async (record) => {
      const client = injectedClient(async () => responseOf(record));
      const error = await client.host.describe({}).catch((thrown: unknown) => thrown);
      expect(error).toBeInstanceOf(TrustFenceError);
      const fenceError = error as TrustFenceError;
      expect(fenceError.status).toBe(record.status);
      expect(fenceError.url).toContain("/api/host.describe");
    },
  );

  it.each(
    trustRecords.filter((record) => record.response !== undefined && record.leg === "stream-open"),
  )("$name maps to TrustFenceError on the stream-open leg", async (record) => {
    const client = injectedClient(async () => responseOf(record));
    const stream = client.events.mux({}, new AbortController().signal);
    const error = await stream[Symbol.asyncIterator]()
      .next()
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(TrustFenceError);
    const fenceError = error as TrustFenceError;
    expect(fenceError.status).toBe(record.status);
    expect(fenceError.url).toContain("/api/events.mux");
  });

  it("the live ws-upgrade refusal is a raw 403 before negotiation", () => {
    const record = byName<TrustRecord>(trustFile, "ws-upgrade-403-untrusted-host");
    if (record.raw === undefined) throw new Error("ws-upgrade record carries no raw bytes");
    expect(record.raw).toContain("HTTP/1.1 403");
    expect(record.raw.endsWith("forbidden")).toBe(true);
  });
});

// ---- backoff behavior ------------------------------------------------------------------

describe("backoff behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Flush microtasks (and zero-delay timers) so the loop settles. */
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  }

  const describeRecord = byName<UnaryRecord>(unaryFile, "host-describe-ok");
  const muxSse = byName<SseRecord>(streamsFile, "events-mux");
  const hostSse = byName<SseRecord>(streamsFile, "events-host");
  const errorSse = byName<SseRecord>(streamsFile, "events-mux-stream-error");

  function transcriptHandler(muxRaw: string): FetchFn {
    return async (input, init) => {
      const { pathname } = new URL(String(input));
      if (pathname === "/api/host.describe") return echoingResponseOf(describeRecord, init);
      if (pathname === "/api/events.mux") {
        return new Response(muxRaw, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (pathname === "/api/events.host") {
        return new Response(hostSse.raw, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return new Response("not found", { status: 404 });
    };
  }

  /**
   * The captured streams are finite, so every generation connects, replays
   * the transcript, loses the stream, and backs off - the assertions stay
   * robust against how many cycles fit into the advanced window.
   */
  function assertDedupedAlternation(states: string[]): void {
    for (let index = 1; index < states.length; index += 1) {
      expect(states[index]).not.toBe(states[index - 1]);
    }
  }

  it("replays the captured transcript into connected, then reconnects with growing backoff", async () => {
    const warn = vi.mocked(console.warn);
    const client = injectedClient(transcriptHandler(muxSse.raw));
    const states: string[] = [];
    const connectedCount = { value: 0 };
    const muxFrames: { rpcId: string; payload: unknown }[] = [];
    const controller = new ConnectionController(client, {
      onStateChange: (state) => states.push(state),
      onConnected: () => {
        connectedCount.value += 1;
      },
      onMuxEnvelope: (envelope) => muxFrames.push(envelope as { rpcId: string; payload: unknown }),
    });

    controller.start();
    await settle();
    expect(states[0]).toBe("connected");
    expect(connectedCount.value).toBeGreaterThanOrEqual(1);
    // the captured subscribed frame reached the sink through the real carrier
    expect(muxFrames.slice(0, muxSse.frames.length)).toStrictEqual(
      muxSse.frames.map((frame) => ({ rpcId: frame.rpcId, payload: frame.payload })),
    );

    // both captured streams end right after the frames: the generation fails
    await settle();
    expect(states).toContain("reconnecting");
    const connectedAfterLoss = states.filter((state) => state === "connected").length;

    // the first retry is jittered into baseMs/2..baseMs (random 0.5 -> 375ms)
    await vi.advanceTimersByTimeAsync(374);
    await settle();
    expect(states.filter((state) => state === "connected").length).toBe(connectedAfterLoss);
    await vi.advanceTimersByTimeAsync(2);
    await settle();
    expect(states.filter((state) => state === "connected").length).toBe(connectedAfterLoss + 1);
    controller.stop();
    await settle();

    assertDedupedAlternation(states);
    expect(warn).toHaveBeenCalledWith("[dsh-api] connection lost, retry #1");
    // resubscribe reopens the stream: the captured transcript replays each generation
    expect(muxFrames.length).toBeGreaterThanOrEqual(muxSse.frames.length * 2);
  });

  it("a captured stream/error frame breaks the pump without reaching the sink", async () => {
    const warn = vi.mocked(console.warn);
    const client = injectedClient(transcriptHandler(errorSse.raw));
    const states: string[] = [];
    const muxFrames: { payload: { type: string } }[] = [];
    const controller = new ConnectionController(client, {
      onStateChange: (state) => states.push(state),
      onMuxEnvelope: (envelope) => muxFrames.push(envelope as { payload: { type: string } }),
    });

    controller.start();
    await settle();
    expect(states[0]).toBe("connected");
    expect(
      muxFrames.slice(0, errorSse.frames.length).map((frame) => frame.payload.type),
    ).toStrictEqual(errorSse.frames.map((frame) => (frame.payload as { type: string }).type));

    // the stream/error frame ends the generation: reconnecting, never yielded
    await vi.advanceTimersByTimeAsync(375);
    await settle();
    controller.stop();
    await settle();

    expect(muxFrames.some((frame) => frame.payload.type === "stream/error")).toBe(false);
    assertDedupedAlternation(states);
    expect(states).toContain("reconnecting");
    expect(states.filter((state) => state === "connected").length).toBeGreaterThanOrEqual(2);
    expect(warn).toHaveBeenCalledWith("[dsh-api] connection lost, retry #1");
  });
});

// ---- fixture hygiene --------------------------------------------------------------------

describe("fixture hygiene", () => {
  it("no auth material or secret-shaped strings in any fixture", () => {
    for (const file of ["unary.jsonl", "streams.jsonl", "trust.jsonl"]) {
      const text = readFileSync(path.join(fixturesDir, file), "utf8");
      expect(text).not.toMatch(/authorization/i);
      expect(text).not.toMatch(/PRIVATE KEY/u);
      expect(text).not.toMatch(/\bsk-[A-Za-z0-9]{16,}/u);
      expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/u);
    }
  });
});
