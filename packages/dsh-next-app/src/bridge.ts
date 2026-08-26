/**
 * next-app-bridge - the unix-socket envelope bridge server (ADR-0003, framing
 * per ADR-0010).
 *
 * Serves the envelope protocol to the Next child over a mode-0600 unix
 * socket under the profile's run directory by reusing the shipped fetch
 * carrier: the row binds an HTTP server to the socket path, adapts
 * IncomingMessage/ServerResponse onto the WHATWG Request/Response pair, and
 * hands every request to `toFetchHandler(apiProxy)` - the same handler the
 * in-box gateway serves over its webserver. The envelope messages, the
 * two-level parse with the pinned zod schemas, the method dispatch, and the
 * bad-request replies are all the shipped package's, not this module's: the
 * bridge defines no routes, so every unary method the gateway serves is
 * available to the app without a bundle change (ADR-0010).
 *
 * Socket lifecycle (ADR-0003): a stale socket file is replaced at boot
 * (probe first - a live listener means a second instance is already serving
 * the same profile, which is a boot failure, not a stale file), the file is
 * unlinked on stop, and the filesystem permissions are the access control.
 * Downlink routes (events.mux/host SSE) are served by the same handler for
 * the downlink story; the row's per-request timeout applies to unary POSTs
 * only, never to streams.
 *
 * Import surface: host packages only, resolved from the user's dsh
 * installation as peerDependencies (ADR-0002).
 *
 * @module @scope/dsh-next-app/bridge
 */
import { chmodSync, rmSync } from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect as netConnect } from "node:net";
import type { ApiProxy } from "@deepseek-ai/dsh-host-apiproxy";
import { toFetchHandler } from "@deepseek-ai/dsh-host-apiproxy";

/** The environment variable the runtime row forwards the socket path to the Next child with. */
export const BRIDGE_SOCKET_ENV = "DSH_NEXT_APP_BRIDGE_SOCKET";

/** Per-request timeout for unary calls (a hung impl must not leave the client pending forever). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** How long to probe a suspicious socket file before treating it as stale. */
const PROBE_TIMEOUT_MS = 200;

/** The bridge server handle the runtime row owns. */
export interface BridgeServer {
  /** Close the listener, drop open connections, and unlink the socket file. */
  stop(): void;
}

/** Options for {@link startBridge}. */
export interface BridgeOptions {
  /** Per-request timeout for unary POSTs; defaults to 30s. */
  requestTimeoutMs?: number;
}

/** Buffer an IncomingMessage body (the handler consumes it through req.json()). */
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** Adapt an IncomingMessage onto the WHATWG Request the shipped handler reads. */
function toRequest(req: IncomingMessage, body: Buffer, baseUrl: string): Request {
  const controller = new AbortController();
  // The handler forwards the request signal into impls that accept one; a
  // client disconnect is the only abort this transport can observe.
  req.once("close", () => controller.abort());
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return new Request(new URL(req.url ?? "/", baseUrl), {
    method: req.method ?? "GET",
    headers,
    // exactOptionalPropertyTypes: the body key is omitted entirely when the
    // request carries none (the handler's GET routes read no body).
    ...(body.length > 0 ? { body } : {}),
    signal: controller.signal,
  });
}

/**
 * Write a WHATWG Response onto the Node ServerResponse, streaming the body
 * (the downlink routes' SSE responses must not be buffered whole).
 */
async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  const body = response.body;
  if (body === null) {
    res.end();
    return;
  }
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch {
    // The client went away mid-stream; there is no one left to tell.
    res.destroy();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Probe a suspicious socket file: a live listener means another instance is
 * already serving this profile (a boot failure, per the caller), while a
 * refused or unanswered connect means the file is stale and replaceable.
 */
function probeSocket(socketPath: string): Promise<"live" | "stale"> {
  return new Promise((resolve) => {
    const socket = netConnect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("stale");
    }, PROBE_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolve("live");
    });
    socket.once("error", () => {
      clearTimeout(timer);
      resolve("stale");
    });
  });
}

/**
 * Create and start the bridge server on `socketPath` (ADR-0003, framing per
 * ADR-0010): replace a stale socket file at boot, refuse to start when a
 * live listener owns the path (a second instance on the same profile is a
 * misconfiguration, and the child must never silently reach the wrong
 * instance's gateway), chmod the socket to mode 0600, unlink on stop, and
 * serve the shipped fetch handler over the socket.
 *
 * @param api - the injected apiProxy service the shipped handler dispatches to.
 * @param socketPath - the socket file under the profile run directory.
 * @param options - timeout tuning.
 * @returns the running bridge server.
 * @throws when the socket path is live-owned or cannot be bound - the
 * profile boot fails loud instead of serving a dead or misdirected bridge.
 */
export async function startBridge(
  api: ApiProxy,
  socketPath: string,
  options?: BridgeOptions,
): Promise<BridgeServer> {
  const requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const state = await probeSocket(socketPath);
  if (state === "live") {
    throw new Error(`next-app-bridge: another instance is already serving ${socketPath}`);
  }
  rmSync(socketPath, { force: true });
  const handler = toFetchHandler(api);
  const server: Server = createHttpServer((req, res) => {
    // Unary calls are POSTs; the row's timeout keeps a hung impl from
    // holding the connection forever. Streams (GET downlinks) are untimed -
    // they live as long as the client does.
    const timer =
      req.method === "POST"
        ? setTimeout(() => {
            if (!res.writableEnded && !res.destroyed) {
              res.statusCode = 504;
              res.end("request timed out");
            }
            req.destroy();
          }, requestTimeoutMs)
        : undefined;
    void (async () => {
      try {
        const body = await readBody(req);
        const request = toRequest(req, body, "http://dsh.internal");
        const response = await handler.fetch(request);
        await writeResponse(res, response);
      } catch (error) {
        if (res.writableEnded || res.destroyed) return;
        res.statusCode = 500;
        res.end(`handler failure: ${String(error)}`);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
  // The listener creates the file with the process umask; the bridge's
  // filesystem permissions are its access control (ADR-0003), so pin them.
  chmodSync(socketPath, 0o600);
  // A listener error after the bind is not a boot failure anymore, but an
  // unhandled 'error' event would crash the host - log it instead.
  server.on("error", (error: Error) => {
    console.error(`next-app-bridge: listener error on ${socketPath}:`, error);
  });
  return {
    stop() {
      server.close();
      server.closeAllConnections();
      rmSync(socketPath, { force: true });
    },
  };
}
