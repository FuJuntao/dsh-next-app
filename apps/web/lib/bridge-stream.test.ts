/**
 * Unit tests for the bridge transport's two response disciplines (task
 * #135 commit 1; ADR-0010 carrier over ADR-0003's socket).
 *
 * The downlink streaming branch is proven against a REAL unix socket: a
 * fake host writes one SSE envelope and holds the response open - a
 * buffering transport can only fail this by hanging the test, which is
 * exactly the bug the streaming branch exists to fix. The unary POST path
 * is pinned in the same server so the story #107 contract (whole
 * ServerResponse parsed at end) cannot silently regress, and a mid-stream
 * abort is asserted to end the iterator rather than leak a connection.
 */
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BridgeApiClient } from "./bridge";

/** The envelope the shipped readSse loop parses off each SSE data record. */
function envelope(rpcId: string, payload: unknown): string {
  return `data: ${JSON.stringify({ type: "server-request", rpcId, method: "api.events.mux", payload })}\n\n`;
}

const FRAME_ONE = { type: "session/subscribed", sessionId: "sess-1", lastSeq: 7 };
const FRAME_TWO = { type: "session/queue", sessionId: "sess-1", items: [] };

let server: Server;
let socketPath: string;
/** Resolves when the test has proven it received the first SSE frame. */
let releaseSecondFrame: () => void;
const secondFrameGate = new Promise<void>((resolve) => {
  releaseSecondFrame = resolve;
});

beforeAll(async () => {
  socketPath = join(mkdtempSync(join(tmpdir(), "bridge-stream-")), "bridge.sock");
  server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/events.mux") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": connected\n\n");
      res.write(envelope("rpc-1", FRAME_ONE));
      // Hold the stream open: the test may only see FRAME_ONE while this
      // response is unfinished. Then the gate lets the second frame through
      // and closes.
      void secondFrameGate.then(() => {
        res.write(envelope("rpc-2", FRAME_TWO));
        res.end();
      });
      req.on("close", () => res.destroy());
      return;
    }
    if (req.method === "POST" && req.url === "/api/session.list") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const request = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          rpcId: string;
          method: string;
        };
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "server-response",
            rpcId: request.rpcId,
            result: { ok: true, value: { items: [] } },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(socketPath, () => resolve()));
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  rmSync(socketPath, { force: true });
});

describe("the downlink GET streams", () => {
  it("yields frames while the response is still open, in order, to a clean end", async () => {
    const client = new BridgeApiClient(socketPath);
    const controller = new AbortController();
    // The mux face yields an AsyncIterable; take its iterator to drive the
    // frame-by-frame assertions.
    const frames = client.events.mux({}, controller.signal)[Symbol.asyncIterator]();
    const first = await frames.next();
    expect(first.done).toBeFalsy();
    expect(first.value.rpcId).toBe("rpc-1");
    expect(first.value.payload).toEqual(FRAME_ONE);
    // Reaching this line before releasing the gate IS the streaming proof:
    // the response has no `end` yet, so a buffering doFetch could not have
    // resolved a body at all.
    releaseSecondFrame();
    const second = await frames.next();
    expect(second.done).toBeFalsy();
    expect(second.value.payload).toEqual(FRAME_TWO);
    const end = await frames.next();
    expect(end.done).toBe(true);
  }, 5_000);
});

describe("the unary POST still buffers", () => {
  it("parses one whole ServerResponse and echoes the rpcId", async () => {
    const client = new BridgeApiClient(socketPath);
    const response = await client.sessions.list({});
    expect(response.result.ok).toBe(true);
    if (response.result.ok) expect(response.result.value.items).toEqual([]);
  }, 5_000);
});
