/**
 * Unary envelope bridge client (server-only) - reuses the shipped apiproxy
 * client (ADR-0010).
 *
 * The gateway package already defines the client the bridge needs
 * (AbstractApiClient: rpcId minting, envelope wrap/unwrap, response and
 * per-method value validation with the pinned schemas, per-request
 * timeouts). This module only supplies the transport aspect the shipped
 * client leaves abstract: a doFetch that speaks HTTP over the runtime row's
 * unix socket (node:http with socketPath) instead of the network. The
 * bridge defines no routes - the app calls the standard IApiClient domain
 * face (client.sessions.list(...)) and every unary method the gateway
 * serves works without a bundle change.
 *
 * This module imports node:http and must only be imported from server
 * components or other server-only code - the client bundle cannot build it.
 * The socket path arrives from the runtime row through
 * DSH_NEXT_APP_BRIDGE_SOCKET; without it (dev without a profile, a stale
 * build) every call fails with {@link BridgeUnavailableError}.
 */
import { request as httpRequest } from "node:http";
import { AbstractApiClient } from "@deepseek-ai/dsh-host-apiproxy/client";

/** The socket path the runtime row forwards to this process. */
const SOCKET_PATH = process.env["DSH_NEXT_APP_BRIDGE_SOCKET"];

/**
 * The bridge is unreachable: the socket env is absent or the socket refused
 * the connection. Callers surface this as the distinct bridge-down state -
 * never stale data.
 */
export class BridgeUnavailableError extends Error {
  constructor(message = "the dsh bridge is unavailable") {
    super(message);
    this.name = "BridgeUnavailableError";
  }
}

/** Mirror fetch's abort rejection (same helper the in-box client uses). */
function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  if (typeof reason === "string") return new Error(reason);
  return new Error("This operation was aborted");
}

/**
 * The shipped fetch-carrier client over the unix-socket bridge. Each call
 * opens its own socket connection (HTTP request/response correlation), so
 * no connection state is shared - the instance is stateless beyond the
 * socket path and can be reused for the server's lifetime.
 */
export class BridgeApiClient extends AbstractApiClient {
  /**
   * @param socketPath - the row's socket file; undefined when the env was
   * absent, in which case every call fails with BridgeUnavailableError.
   * @param timeoutMs - bounded unary call deadline (the shipped 30s default).
   */
  constructor(
    private readonly socketPath: string | undefined,
    timeoutMs?: number,
  ) {
    super(timeoutMs);
  }

  /** Transport aspect: one HTTP request over the unix socket. */
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      if (this.socketPath === undefined) {
        reject(new BridgeUnavailableError("DSH_NEXT_APP_BRIDGE_SOCKET is not set"));
        return;
      }
      if (signal?.aborted) {
        reject(abortError(signal));
        return;
      }
      const req = httpRequest(
        {
          socketPath: this.socketPath,
          path: input.pathname + input.search,
          method: init?.method ?? "GET",
          // exactOptionalPropertyTypes: optional RequestOptions keys are
          // omitted, never set to undefined.
          ...(init?.headers !== undefined && {
            headers: init.headers as Record<string, string>,
          }),
          ...(signal !== undefined && signal !== null && { signal }),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          res.on("error", (error: Error) => {
            reject(
              new BridgeUnavailableError(`reading the bridge response failed: ${error.message}`),
            );
          });
          res.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode ?? 500,
                ...(res.statusMessage !== undefined && { statusText: res.statusMessage }),
                headers: res.headers as Record<string, string>,
              }),
            );
          });
        },
      );
      req.on("error", (error: Error) => {
        // The client aborted the call (its own timeout or an external
        // signal): mirror fetch's abort rejection instead of a transport
        // error, exactly like the in-box in-process client.
        if (signal?.aborted) {
          reject(abortError(signal));
        } else {
          reject(new BridgeUnavailableError(`cannot reach the dsh bridge: ${error.message}`));
        }
      });
      const body = init?.body;
      if (body !== undefined && body !== null) {
        req.write(typeof body === "string" ? body : Buffer.from(body as ArrayBuffer));
      }
      req.end();
    });
  }
}

/** The shared client for the server's lifetime (the class holds no connection state). */
let shared: BridgeApiClient | undefined;

/** The bridge client; calls fail with BridgeUnavailableError when the bridge is down. */
export function getBridgeClient(): BridgeApiClient {
  shared ??= new BridgeApiClient(SOCKET_PATH);
  return shared;
}
