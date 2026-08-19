import type { IApiClient } from "@deepseek-ai/dsh-host-apiproxy/client";
import { AbstractApiClient, InProcessApiClient } from "@deepseek-ai/dsh-host-apiproxy/client";
import { assertTrusted } from "./trust-fence.js";

/**
 * Explicit transport selection for createDshClient - never sniffed at
 * runtime: 'browser' rides a same-origin streaming fetch (ADR-0003);
 * { handler } rides an injected in-process FetchHandler (server
 * components, tests).
 */
export type DshTransport = "browser" | { handler: { fetch: typeof fetch } };

/**
 * Browser transport: global fetch against the same-origin /api gateway.
 * Protocol invariants stay upstream (AbstractApiClient); this subclass
 * supplies only the transport aspect, fenced at the edge.
 */
class BrowserDshClient extends AbstractApiClient {
  protected override async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return assertTrusted(await fetch(input, init), input);
  }
}

/**
 * Injected transport: upstream InProcessApiClient (abort-faithful doFetch)
 * with the trust fence wrapped around it.
 */
class InjectedDshClient extends InProcessApiClient {
  protected override async doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return assertTrusted(await super.doFetch(input, init), input);
  }
}

function isHandlerTransport(transport: unknown): transport is { handler: { fetch: typeof fetch } } {
  if (typeof transport !== "object" || transport === null) return false;
  const handler = (transport as { handler?: unknown }).handler;
  if (typeof handler !== "object" || handler === null) return false;
  return typeof (handler as { fetch?: unknown }).fetch === "function";
}

/**
 * Create the isomorphic dsh /api client over an explicit transport.
 * Both variants are AbstractApiClient subclasses riding the same doFetch
 * seam (streaming fetch per ADR-0003 - never EventSource, never WebSocket),
 * with 401/403 mapped to TrustFenceError at the transport edge (ADR-0004).
 * @param options - transport: 'browser' | { handler: { fetch } }.
 * @returns the payload-direct client consumption face (IApiClient).
 */
export function createDshClient(options: { transport: DshTransport }): IApiClient {
  const opts = options as unknown;
  if (typeof opts !== "object" || opts === null) {
    throw new TypeError("createDshClient: options must be { transport }.");
  }
  const transport: unknown = (opts as { transport?: unknown }).transport;
  if (transport === "browser") return new BrowserDshClient();
  if (isHandlerTransport(transport)) {
    return new InjectedDshClient(transport.handler);
  }
  throw new TypeError("createDshClient: transport must be 'browser' or { handler: { fetch } }.");
}
