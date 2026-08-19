import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionState,
  HostDescription,
  HostFrame,
  IApiClient,
  MuxFrame,
  RpcRequest,
} from "./index.js";
import { createDshClient } from "./client.js";
import { ConnectionController } from "./connection.js";

/**
 * Connection-loop semantics against a fake client + fake timers: backoff
 * growth/jitter, state dedup, handshake signal, sink isolation, and loss
 * behavior (AC 3/AC 4). Heartbeat skipping is asserted at the SSE layer,
 * where it physically lives, through the real client with an injected
 * handler. No network, no live host.
 */

const DESCRIBE_VALUE = {
  version: "0.1.0-rc.7",
  cwd: "/tmp",
  attachedSessions: 0,
  canOpenPath: false,
};

/** Flush microtasks (and zero-delay timers) so the loop settles. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

/** Branded wire ids are compile-time casts; one contained helper keeps the tests honest. */
function muxEnvelope(rpcId: string, payload: MuxFrame): RpcRequest<MuxFrame> {
  return { rpcId, payload } as unknown as RpcRequest<MuxFrame>;
}

const SUBSCRIBED_PAYLOAD = {
  type: "session/subscribed",
  sessionId: "session-fixture",
  lastSeq: 1,
} as unknown as MuxFrame;

const SUBSCRIBED = muxEnvelope("mux-1", SUBSCRIBED_PAYLOAD);

// ---- fake client ----------------------------------------------------------

type StreamFactory<F extends MuxFrame | HostFrame> = (
  signal: AbortSignal,
  onOpen: (() => void) | undefined,
) => AsyncIterable<RpcRequest<F>>;

function controlledStream<F extends MuxFrame | HostFrame>() {
  const queue: RpcRequest<F>[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let failure: Error | undefined;
  const notify = () => {
    wake?.();
  };
  async function* iterate(): AsyncGenerator<RpcRequest<F>> {
    for (;;) {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next !== undefined) yield next;
      }
      if (failure !== undefined) throw failure;
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
  }
  return {
    iterable: iterate(),
    push(envelope: RpcRequest<F>) {
      queue.push(envelope);
      notify();
    },
    end() {
      ended = true;
      notify();
    },
    fail(error: Error) {
      failure = error;
      notify();
    },
  };
}

type Controlled<F extends MuxFrame | HostFrame> = ReturnType<typeof controlledStream<F>>;

/** Mirror the real carrier: aborting the generation signal kills the stream. */
function wireAbort<F extends MuxFrame | HostFrame>(cs: Controlled<F>, signal: AbortSignal): void {
  signal.addEventListener("abort", () => cs.fail(new Error("aborted")), { once: true });
}

/**
 * Minimal fake IApiClient: the controller only touches events.mux,
 * events.host, and host.describe, so the cast stays in this one place.
 */
function fakeClient(parts: {
  mux: StreamFactory<MuxFrame>;
  host: StreamFactory<HostFrame>;
  describe?: () => Promise<unknown>;
}): IApiClient {
  const describe =
    parts.describe ??
    (() => Promise.resolve({ rpcId: "describe-1", result: { ok: true, value: DESCRIBE_VALUE } }));
  return {
    events: {
      mux: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) =>
        parts.mux(signal, onOpen),
      host: (_payload: unknown, signal: AbortSignal, onOpen?: () => void) =>
        parts.host(signal, onOpen),
    },
    host: { describe: () => describe() },
  } as unknown as IApiClient;
}

/** Streams that end immediately and never open: every generation fails. */
function failingClient(): IApiClient {
  const fail: StreamFactory<MuxFrame | HostFrame> = () => {
    const cs = controlledStream<MuxFrame>();
    cs.end();
    return cs.iterable;
  };
  return fakeClient({
    mux: fail as StreamFactory<MuxFrame>,
    host: fail as StreamFactory<HostFrame>,
  });
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("connection handshake", () => {
  it("completes mux+host+describe and signals connected then onConnected", async () => {
    const mux = controlledStream<MuxFrame>();
    const host = controlledStream<HostFrame>();
    const api = fakeClient({
      mux: (signal, onOpen) => {
        wireAbort(mux, signal);
        onOpen?.();
        return mux.iterable;
      },
      host: (signal, onOpen) => {
        wireAbort(host, signal);
        onOpen?.();
        return host.iterable;
      },
    });
    const states: ConnectionState[] = [];
    const connected: HostDescription[] = [];
    const controller = new ConnectionController(api, {
      onStateChange: (state) => states.push(state),
      onConnected: (description) => connected.push(description),
    });

    controller.start();
    await settle();

    expect(states).toStrictEqual(["connected"]);
    expect(connected).toStrictEqual([DESCRIBE_VALUE]);
    expect(warnSpy).not.toHaveBeenCalled();
    controller.stop();
  });

  it("proceeds as connected when the streams never fire onOpen (open timeout)", async () => {
    const mux = controlledStream<MuxFrame>();
    const host = controlledStream<HostFrame>();
    const api = fakeClient({
      mux: (signal) => {
        wireAbort(mux, signal);
        return mux.iterable;
      },
      host: (signal) => {
        wireAbort(host, signal);
        return host.iterable;
      },
    });
    const states: ConnectionState[] = [];
    const connected: HostDescription[] = [];
    const controller = new ConnectionController(
      api,
      {
        onStateChange: (state) => states.push(state),
        onConnected: (description) => connected.push(description),
      },
      { streamOpenTimeoutMs: 20 },
    );

    controller.start();
    await settle();
    expect(states).toStrictEqual([]);

    await vi.advanceTimersByTimeAsync(20);
    await settle();
    expect(states).toStrictEqual(["connected"]);
    expect(connected).toStrictEqual([DESCRIBE_VALUE]);
    controller.stop();
  });

  it("aborts the generation when host.describe returns a business error", async () => {
    const mux = controlledStream<MuxFrame>();
    const host = controlledStream<HostFrame>();
    const api = fakeClient({
      mux: (signal, onOpen) => {
        wireAbort(mux, signal);
        onOpen?.();
        return mux.iterable;
      },
      host: (signal, onOpen) => {
        wireAbort(host, signal);
        onOpen?.();
        return host.iterable;
      },
      describe: () =>
        Promise.resolve({
          rpcId: "describe-1",
          result: { ok: false, error: { code: "internal", message: "boom", details: {} } },
        }),
    });
    const states: ConnectionState[] = [];
    const connected: HostDescription[] = [];
    const controller = new ConnectionController(api, {
      onStateChange: (state) => states.push(state),
      onConnected: (description) => connected.push(description),
    });

    controller.start();
    await settle();

    expect(connected).toStrictEqual([]);
    expect(states).toStrictEqual(["reconnecting"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    controller.stop();
  });
});

describe("state dedup", () => {
  it("emits nothing before the first handshake and dedups transitions across loss/reconnect", async () => {
    const muxStreams: Controlled<MuxFrame>[] = [];
    const hostStreams: Controlled<HostFrame>[] = [];
    const api = fakeClient({
      mux: (signal, onOpen) => {
        const cs = controlledStream<MuxFrame>();
        wireAbort(cs, signal);
        onOpen?.();
        muxStreams.push(cs);
        return cs.iterable;
      },
      host: (signal, onOpen) => {
        const cs = controlledStream<HostFrame>();
        wireAbort(cs, signal);
        onOpen?.();
        hostStreams.push(cs);
        return cs.iterable;
      },
    });
    const states: ConnectionState[] = [];
    const connected: HostDescription[] = [];
    const controller = new ConnectionController(api, {
      onStateChange: (state) => states.push(state),
      onConnected: (description) => connected.push(description),
    });

    controller.start();
    await settle();
    expect(states).toStrictEqual(["connected"]);

    // Lose generation 1: first pump end aborts the generation.
    muxStreams[0]?.end();
    await settle();
    expect(states).toStrictEqual(["connected", "reconnecting"]);

    // Backoff 375ms (random = 0.5), then generation 2 reconnects.
    await vi.advanceTimersByTimeAsync(375);
    await settle();
    expect(states).toStrictEqual(["connected", "reconnecting", "connected"]);
    expect(connected).toHaveLength(2);

    // Lose generation 2: reconnecting is emitted again (change, not dup).
    muxStreams[1]?.end();
    await settle();
    expect(states).toStrictEqual(["connected", "reconnecting", "connected", "reconnecting"]);
    controller.stop();
    expect(hostStreams).toHaveLength(2);
  });
});

describe("backoff", () => {
  it.each([
    { jitter: 0, firstDelay: 250 },
    { jitter: 0.5, firstDelay: 375 },
    { jitter: 1, firstDelay: 500 },
  ])(
    "jitters the first retry to $firstDelay ms (random = $jitter)",
    async ({ jitter, firstDelay }) => {
      vi.mocked(Math.random).mockReturnValue(jitter);
      const controller = new ConnectionController(failingClient(), {}, { streamOpenTimeoutMs: 1 });

      controller.start();
      await settle();
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(firstDelay - 1);
      await settle();
      expect(warnSpy).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2);
      await settle();
      expect(warnSpy).toHaveBeenCalledTimes(2);
      controller.stop();
    },
  );

  it("grows the backoff cap per consecutive failed attempt", async () => {
    vi.mocked(Math.random).mockReturnValue(0);
    const controller = new ConnectionController(failingClient(), {}, { streamOpenTimeoutMs: 1 });

    controller.start();
    await settle();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Attempt 1: cap 500, delay 250.
    await vi.advanceTimersByTimeAsync(249);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(2);

    // Attempt 2: cap 1000, delay 500 - growth, not a repeat of 250.
    await vi.advanceTimersByTimeAsync(499);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(3);
    controller.stop();
  });

  it("keeps repeated loss in reconnecting with growing backoff, never throwing (AC 4)", async () => {
    const states: ConnectionState[] = [];
    const controller = new ConnectionController(
      failingClient(),
      { onStateChange: (state) => states.push(state) },
      { streamOpenTimeoutMs: 1 },
    );

    controller.start();
    await settle();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(states).toStrictEqual(["reconnecting"]);

    // Two more losses: deduped state, growing backoff (375 then 750).
    await vi.advanceTimersByTimeAsync(375 + 1);
    await settle();
    await vi.advanceTimersByTimeAsync(750 + 1);
    await settle();
    expect(states).toStrictEqual(["reconnecting"]);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(warnSpy).toHaveBeenNthCalledWith(1, "[dsh-api] connection lost, retry #1");
    expect(warnSpy).toHaveBeenNthCalledWith(2, "[dsh-api] connection lost, retry #2");
    expect(warnSpy).toHaveBeenNthCalledWith(3, "[dsh-api] connection lost, retry #3");

    // The loop is still alive after repeated loss.
    await vi.advanceTimersByTimeAsync(1500 + 1);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(4);
    controller.stop();
  });
});

describe("frame sinks", () => {
  async function connectedController(sinks: {
    onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void;
    onStateChange?: (state: ConnectionState) => void;
  }): Promise<{ controller: ConnectionController; mux: Controlled<MuxFrame> }> {
    const mux = controlledStream<MuxFrame>();
    const host = controlledStream<HostFrame>();
    const api = fakeClient({
      mux: (signal, onOpen) => {
        wireAbort(mux, signal);
        onOpen?.();
        return mux.iterable;
      },
      host: (signal, onOpen) => {
        wireAbort(host, signal);
        onOpen?.();
        return host.iterable;
      },
    });
    const controller = new ConnectionController(api, sinks);
    controller.start();
    await settle();
    return { controller, mux };
  }

  it("isolates sink exceptions: a throwing sink never kills the pump", async () => {
    const seen: RpcRequest<MuxFrame>[] = [];
    const { controller, mux } = await connectedController({
      onMuxEnvelope: (envelope) => {
        seen.push(envelope);
        throw new Error("broken business layer");
      },
    });

    mux.push(SUBSCRIBED);
    await settle();
    expect(seen).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();

    // The pump survives and delivers the next frame.
    mux.push(muxEnvelope("mux-2", SUBSCRIBED_PAYLOAD));
    await settle();
    expect(seen).toHaveLength(2);
    controller.stop();
  });

  it("breaks the pump on a stream/error frame without yielding it", async () => {
    const seen: RpcRequest<MuxFrame>[] = [];
    const states: ConnectionState[] = [];
    const { controller, mux } = await connectedController({
      onMuxEnvelope: (envelope) => seen.push(envelope),
      onStateChange: (state) => states.push(state),
    });

    mux.push(SUBSCRIBED);
    await settle();
    mux.push(
      muxEnvelope("mux-err", {
        type: "stream/error",
        error: { code: "internal", message: "x", details: {} },
      }),
    );
    await settle();

    expect(seen).toStrictEqual([SUBSCRIBED]);
    expect(states).toContain("reconnecting");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    controller.stop();
  });
});

describe("stop", () => {
  it("stops a connected loop without a reconnect", async () => {
    const mux = controlledStream<MuxFrame>();
    const host = controlledStream<HostFrame>();
    const api = fakeClient({
      mux: (signal, onOpen) => {
        wireAbort(mux, signal);
        onOpen?.();
        return mux.iterable;
      },
      host: (signal, onOpen) => {
        wireAbort(host, signal);
        onOpen?.();
        return host.iterable;
      },
    });
    const states: ConnectionState[] = [];
    const controller = new ConnectionController(api, {
      onStateChange: (state) => states.push(state),
    });

    controller.start();
    await settle();
    controller.stop();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();

    expect(states).toStrictEqual(["connected"]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("stop is idempotent and start after stop resumes", async () => {
    // Fresh streams per generation call, like the real carrier.
    const api = fakeClient({
      mux: (signal, onOpen) => {
        const cs = controlledStream<MuxFrame>();
        wireAbort(cs, signal);
        onOpen?.();
        return cs.iterable;
      },
      host: (signal, onOpen) => {
        const cs = controlledStream<HostFrame>();
        wireAbort(cs, signal);
        onOpen?.();
        return cs.iterable;
      },
    });
    const controller = new ConnectionController(api, {});
    controller.start();
    controller.start();
    await settle();
    controller.stop();
    controller.stop();
    await settle();
    controller.start();
    await settle();
    controller.stop();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("exits at the next loop check when stopped mid-backoff (upstream semantics)", async () => {
    const controller = new ConnectionController(failingClient(), {}, { streamOpenTimeoutMs: 1 });

    controller.start();
    await settle();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Stop mid-backoff: the sleep is not cut short (upstream behavior),
    // but the loop exits on wake instead of retrying.
    controller.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("heartbeat skipping (SSE layer, real client)", () => {
  function sseResponse(text: string): Response {
    return new Response(text, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }

  it("skips heartbeat lines: never yielded, never stream-killing", async () => {
    const frame = {
      type: "server-request",
      rpcId: "frame-1",
      method: "events.mux",
      payload: { type: "session/subscribed", sessionId: "session-fixture", lastSeq: 3 },
    };
    const body = [
      ": keepalive",
      "",
      "",
      "data: " + JSON.stringify(frame),
      "",
      "",
      ": keepalive",
      "",
      "",
      "data: ",
      "",
      "",
    ].join("\n");
    const client = createDshClient({
      transport: { handler: { fetch: async () => sseResponse(body) } },
    });

    const frames: unknown[] = [];
    const signal = new AbortController().signal;
    for await (const envelope of client.events.mux({}, signal)) {
      frames.push(envelope);
    }

    expect(frames).toStrictEqual([{ rpcId: "frame-1", payload: frame.payload }]);
  });
});
