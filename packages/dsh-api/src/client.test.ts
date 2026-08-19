import { afterEach, describe, expect, it, vi } from "vitest";
import { createDshClient, TrustFenceError } from "./index.js";

/**
 * Factory, transports, and trust-fence semantics against scripted fakes:
 * no network, no live host. Wire-format coverage against recorded golden
 * transcripts lands in task 4 (issue #43).
 */

type FetchFn = (input: URL, init?: RequestInit) => Promise<Response>;

/** A host.describe value satisfying the upstream schema (all plain fields). */
const DESCRIBE_VALUE = {
  version: "0.1.0-rc.7",
  cwd: "/tmp",
  attachedSessions: 0,
  canOpenPath: false,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Extract the rpcId from the client-request envelope of a POST leg. */
function requestRpcId(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  return (JSON.parse(body) as { rpcId: string }).rpcId;
}

/** Answer a unary call with a server-response envelope echoing the rpcId. */
function unaryResult(status: number, result: unknown): FetchFn {
  return async (_input, init) =>
    jsonResponse(status, {
      type: "server-response",
      rpcId: requestRpcId(init),
      result,
    });
}

/** Answer with a bare HTTP status and no body. */
const statusOnly =
  (status: number): FetchFn =>
  async () =>
    new Response(null, { status });

function sseResponse(events: readonly unknown[]): Response {
  const text = events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("");
  return new Response(text, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** One subscribed control frame in its server-request envelope. */
const MUX_SUBSCRIBED = {
  type: "server-request",
  rpcId: "frame-1",
  method: "events.mux",
  payload: {
    type: "session/subscribed",
    sessionId: "session-fixture",
    lastSeq: 7,
  },
};

function injectedClient(fetchImpl: FetchFn) {
  return createDshClient({ transport: { handler: { fetch: fetchImpl } } });
}

describe("createDshClient dispatch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'browser' rides the global fetch against the same-origin gateway", async () => {
    const seen: { url: string; method: string | undefined }[] = [];
    const fetchImpl: FetchFn = async (input, init) => {
      seen.push({ url: String(input), method: init?.method });
      return unaryResult(200, { ok: true, value: DESCRIBE_VALUE })(input, init);
    };
    vi.stubGlobal("location", { origin: "https://app.example" });
    vi.stubGlobal("fetch", fetchImpl);

    const client = createDshClient({ transport: "browser" });
    const response = await client.host.describe({});

    expect(response.result).toStrictEqual({ ok: true, value: DESCRIBE_VALUE });
    expect(seen).toStrictEqual([{ url: "https://app.example/api/host.describe", method: "POST" }]);
  });

  it("'{ handler }' rides only the injected fetch", async () => {
    let calls = 0;
    const fetchImpl: FetchFn = async (input, init) => {
      calls += 1;
      return unaryResult(200, { ok: true, value: DESCRIBE_VALUE })(input, init);
    };
    const client = injectedClient(fetchImpl);
    const response = await client.host.describe({});
    expect(response.result.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("refuses an explicit transport that is neither", () => {
    expect(() => createDshClient({ transport: "websocket" as never })).toThrow(TypeError);
    expect(() => createDshClient({ transport: {} as never })).toThrow(TypeError);
    expect(() => createDshClient({ transport: { handler: {} } as never })).toThrow(/handler/u);
  });
});

describe("trust fence", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([401, 403] as const)("maps a unary HTTP %i to TrustFenceError", async (status) => {
    const client = injectedClient(statusOnly(status));
    const error = await client.host.describe({}).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(TrustFenceError);
    expect((error as TrustFenceError).status).toBe(status);
    expect((error as TrustFenceError).url).toContain("/api/host.describe");
  });

  it.each([401, 403] as const)("maps a stream-open HTTP %i to TrustFenceError", async (status) => {
    const client = injectedClient(statusOnly(status));
    const stream = client.events.mux({}, new AbortController().signal);
    const error = await stream[Symbol.asyncIterator]()
      .next()
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(TrustFenceError);
    expect((error as TrustFenceError).status).toBe(status);
    expect((error as TrustFenceError).url).toContain("/api/events.mux");
  });

  it("leaves other transport failures to the upstream error", async () => {
    const client = injectedClient(statusOnly(500));
    const error = await client.host.describe({}).catch((thrown: unknown) => thrown);
    expect(error).not.toBeInstanceOf(TrustFenceError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      "transport failure for /api/host.describe: HTTP 500",
    );
  });

  it("leaves business errors in the typed RpcResult error slot", async () => {
    const businessError = { code: "internal", message: "boom", details: {} };
    const client = injectedClient(unaryResult(200, { ok: false, error: businessError }));
    const response = await client.host.describe({});
    expect(response.result).toStrictEqual({ ok: false, error: businessError });
  });

  it("fences the browser leg too", async () => {
    vi.stubGlobal("fetch", statusOnly(403));
    const client = createDshClient({ transport: "browser" });
    await expect(client.host.describe({})).rejects.toBeInstanceOf(TrustFenceError);
  });
});

describe("streaming fetch wiring", () => {
  it("yields parsed mux frames from the SSE body", async () => {
    const client = injectedClient(async () => sseResponse([MUX_SUBSCRIBED]));
    const frames: unknown[] = [];
    const stream = client.events.mux({}, new AbortController().signal);
    for await (const frame of stream) frames.push(frame);
    expect(frames).toStrictEqual([{ rpcId: "frame-1", payload: MUX_SUBSCRIBED.payload }]);
  });
});
