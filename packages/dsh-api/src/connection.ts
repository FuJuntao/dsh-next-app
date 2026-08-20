/**
 * Connection loop: dual-stream connect/pump/reconnect with jittered
 * exponential backoff.
 *
 * Ported with attribution from @deepseek-ai/dsh-client-connection
 * 0.1.0-rc.7 (deepseek-ai/deepseek-harness, packages/client/connection).
 * Upstream does not export this controller at its package boundary;
 * dsh-api ports it keeping the same ConnectionSinks/ConnectionConfig
 * contract and loop semantics. Differences from upstream: log prefix is
 * [dsh-api] instead of [web-runtime]; coverage annotations dropped.
 *
 * Upstream license (MIT), reproduced per its terms:
 *
 * Copyright (c) 2026 DeepSeek
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type {
  HostFrame,
  MuxFrame,
  ResponseValue,
  RpcRequest,
} from "@deepseek-ai/dsh-host-apiproxy/api";
import type { IApiClient } from "@deepseek-ai/dsh-host-apiproxy/client";

/** Successful value returned by the connection-generation host handshake. */
export type HostDescription = ResponseValue<"host.describe">;

/**
 * Reconnect/backoff tunables (deployment-varying - no hardcoded tunables).
 * All fields optional; defaults below.
 */
export interface ConnectionConfig {
  /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
  backoffBaseMs?: number;
  /** Exponential growth factor per consecutive failed attempt. */
  backoffFactor?: number;
  /** Upper bound for the backoff cap in ms. */
  backoffMaxMs?: number;
  /**
   * Cap on waiting for both streams' onOpen before onConnected, in ms. The
   * strict handshake waits for mux+host stream establishment plus describe;
   * a carrier that never fires onOpen (misbehaving proxy) must not wedge the
   * connection forever - on timeout the generation proceeds as connected and
   * the live-gap repair path covers stragglers.
   */
  streamOpenTimeoutMs?: number;
}

/**
 * Coarse connection state for the UI: 'connected' after each generation's
 * handshake, 'reconnecting' the moment the generation fails (covers the
 * whole backoff+retry span).
 */
export type ConnectionState = "connected" | "reconnecting";

/**
 * Frame sink callbacks: the controller owns the physical streams; business
 * dispatch belongs to the consumer.
 */
export interface ConnectionSinks {
  onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void;
  onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void;
  /** After each connection generation is established (both streams open + describe succeeded), first connect included. */
  onConnected?: (description: HostDescription) => void;
  /**
   * Coarse state transitions (deduplicated: fires only on change). The
   * initial pre-connect span reports nothing - the UI treats "no state yet"
   * as connecting, not as an outage.
   */
  onStateChange?: (state: ConnectionState) => void;
}

const CONNECTION_DEFAULTS: Required<ConnectionConfig> = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  streamOpenTimeoutMs: 3_000,
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

/**
 * Opens both streams and keeps iterating (pull mode: nothing reads the
 * socket and the tap never fires unless someone for-awaits), reconnecting
 * with exponential backoff on loss. State (generation/attempt) is
 * instance-private, never in the store. The pump body feeds each frame to a
 * sink (sink exceptions must not kill the pump - a broken business layer
 * must not drag down the connection layer).
 */
export class ConnectionController {
  private readonly api: IApiClient;
  private readonly sinks: ConnectionSinks;
  private generation = 0;
  private attempt = 0;
  private current: AbortController | null = null;
  private running = false;
  private lastState: ConnectionState | null = null;
  private readonly config: Required<ConnectionConfig>;

  constructor(api: IApiClient, sinks: ConnectionSinks = {}, config: ConnectionConfig = {}) {
    this.api = api;
    this.sinks = sinks;
    this.config = { ...CONNECTION_DEFAULTS, ...config };
  }

  /** Idempotent: begin the connect/pump/reconnect loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  /** Stop the loop and abort the current generation's streams. */
  stop(): void {
    this.running = false;
    this.current?.abort();
    this.current = null;
  }

  private backoffDelay(attempt: number): number {
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config;
    const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1));
    return cap / 2 + Math.random() * (cap / 2);
  }

  /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
  private isRunning(): boolean {
    return this.running;
  }

  /** Re-read both mutable liveness guards after a potentially reentrant sink. */
  private isGenerationActive(controller: AbortController): boolean {
    return this.isRunning() && !controller.signal.aborted;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const gen = ++this.generation;
      const ac = new AbortController();
      this.current = ac;
      let muxOpened: () => void = () => {};
      let hostOpened: () => void = () => {};
      const streamsOpen = Promise.all([
        new Promise<void>((resolve) => {
          muxOpened = resolve;
        }),
        new Promise<void>((resolve) => {
          hostOpened = resolve;
        }),
      ]);
      const failed = new Promise<void>((resolve) => {
        const settle = () => {
          if (gen === this.generation && !ac.signal.aborted) ac.abort();
          resolve();
        };
        this.pumpStream(
          this.api.events.mux({}, ac.signal, muxOpened),
          this.sinks.onMuxEnvelope,
          settle,
        );
        this.pumpStream(
          this.api.events.host({}, ac.signal, hostOpened),
          this.sinks.onHostEnvelope,
          settle,
        );
      });
      try {
        const timeout = new AbortController();
        const [description] = await Promise.all([
          this.api.host.describe({}),
          Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)]),
        ]);
        timeout.abort();
        const descriptionResult = description.result;
        if (!descriptionResult.ok) {
          throw new Error(
            "host.describe failed: " +
              descriptionResult.error.code +
              ": " +
              descriptionResult.error.message,
          );
        }
        if (ac.signal.aborted) throw new Error("generation aborted during readiness handshake");
        this.attempt = 0;
        this.emitState("connected");
        if (this.isGenerationActive(ac)) {
          this.callSink(() => {
            this.sinks.onConnected?.(descriptionResult.value);
          });
        }
      } catch {
        if (!ac.signal.aborted) ac.abort();
      }
      await failed;
      if (!this.isRunning()) return;
      this.emitState("reconnecting");
      this.attempt += 1;
      console.warn("[dsh-api] connection lost, retry #" + this.attempt);
      const idle = new AbortController();
      await sleep(this.backoffDelay(this.attempt), idle.signal);
    }
  }

  /** Deduplicated state emission (sink isolation applies). */
  private emitState(state: ConnectionState): void {
    if (this.lastState === state) return;
    this.lastState = state;
    this.callSink(() => this.sinks.onStateChange?.(state));
  }

  private async pumpStream<F extends MuxFrame | HostFrame>(
    stream: AsyncIterable<RpcRequest<F>>,
    sink: ((envelope: RpcRequest<F>) => void) | undefined,
    onEnd: () => void,
  ): Promise<void> {
    try {
      for await (const envelope of stream) {
        if (envelope.payload.type === "stream/error") break;
        if (sink !== undefined) {
          this.callSink(() => {
            sink(envelope);
          });
        }
      }
    } catch {
      // Stream loss (transport throw, abort): the generation fail path
      // reconnects; one pump dying must never throw out of the loop.
    }
    onEnd();
  }

  /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
  private callSink(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      console.error("[dsh-api] connection sink threw:", error);
    }
  }
}
