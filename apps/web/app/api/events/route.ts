/**
 * GET /api/events - the per-tab chat downlink (story #134 task #135 commit 1;
 * ADR-0003 SSE, ADR-0010 carrier, ADR-0001 re-emission).
 *
 * The browser subscribes here (streaming fetch with credentials; not
 * EventSource, which cannot carry the fence's Basic auth on every engine)
 * and receives the session's mux frames re-emitted as Next-native JSON
 * (lib/downlink.ts is the one boundary the envelope crosses). Each
 * subscription opens exactly ONE bridge mux connection (ADR-0003: each
 * live downlink is its own connection), filtered server-side to the
 * requested session, so a tab never carries traffic for a session it is
 * not showing.
 *
 * SSE discipline (ADR-0003): a `: ping` comment every HEARTBEAT_MS keeps
 * proxies from idling the connection out; `x-accel-buffering: no` asks the
 * gateway not to buffer; no `id:` frames are emitted, because resume is
 * resubscribe + re-sync, not cursor replay. That recovery model is why
 * every connection failure is just an end of stream: a bridge that
 * refuses connects, a mux iterator that throws, and a host that drops the
 * connection all surface to the client as a closed body, and one code
 * path - resubscribe + refetch the tail - covers them (commit 6 wires the
 * client; the page's bridge-down STATE is the first paint's, from the
 * history fetch, AC 23).
 *
 * A client disconnect aborts the bridge connection through the request
 * signal. The route is covered by the edge fence like every other door
 * (AC 24) and opens no new credential surface: the bridge socket is the
 * only authority it speaks with.
 */
import { encodeHeartbeat, encodeSse, frameBelongsToSession, toDownlinkEvent } from "@/lib/downlink";
import { getStreamBridgeClient } from "@/lib/bridge";

/** SSE requires the handler to run per-request; nothing here is cacheable. */
export const dynamic = "force-dynamic";

/** Comment-frame cadence - loose against browser reconnect timers, tight enough for edge proxies. */
const HEARTBEAT_MS = 15_000;

/** Headers every live downlink answer carries (ADR-0003's SSE rules). */
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-store, must-revalidate",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

export async function GET(request: Request): Promise<Response> {
  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (sessionId === null || sessionId === "") {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  const client = getStreamBridgeClient();
  // One controller drives the bridge connection; both the browser's abort
  // and any pump exit flow into it.
  const abort = new AbortController();
  const onClientAbort = (): void => abort.abort();
  request.signal.addEventListener("abort", onClientAbort, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const cleanup = (): void => {
        if (heartbeat !== undefined) clearInterval(heartbeat);
        request.signal.removeEventListener("abort", onClientAbort);
      };
      const send = (chunk: string): void => {
        controller.enqueue(encoder.encode(chunk));
      };
      // The leading comment flushes headers to the client immediately -
      // the subscription is established once bytes move, before any frame.
      send(encodeHeartbeat());
      heartbeat = setInterval(() => {
        try {
          send(encodeHeartbeat());
        } catch {
          cleanup(); // closed under us; the pump's own exit releases the bridge
        }
      }, HEARTBEAT_MS);
      void (async () => {
        try {
          for await (const message of client.events.mux({}, abort.signal)) {
            if (!frameBelongsToSession(message.payload, sessionId)) continue;
            send(encodeSse(toDownlinkEvent(message.rpcId, message.payload)));
          }
          controller.close(); // host ended the stream; the client resubscribes
        } catch {
          // Browser abort (the expected ending) or bridge drop; both are
          // "the stream is over" for the client. The disconnect abort is
          // the steady state, so nothing is logged here - a wedged bridge
          // would already have surfaced in the page's unary calls.
          try {
            controller.close();
          } catch {
            // already closed by the consumer
          }
        } finally {
          cleanup();
          abort.abort(); // release the bridge connection on every exit path
        }
      })();
    },
    cancel() {
      abort.abort();
      request.signal.removeEventListener("abort", onClientAbort);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
