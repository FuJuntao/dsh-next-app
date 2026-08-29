import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { httpPost } from "../support/bridge-client";
import { readState } from "../support/state";

const state = readState();

/**
 * The unix-socket bridge contract (ADR-0003 socket lifecycle, ADR-0010
 * framing), asserted against the packed artifact's live profile: the
 * runtime row serves the shipped fetch handler over the socket under the
 * profile run directory (named per serving port, so instances of the same
 * profile never fight over one socket file), with mode 0600 - the
 * filesystem permissions are the access control. The requests are the
 * envelope protocol the shipped carrier speaks: POST /api/<method> with a
 * ClientRequest JSON body, answered by a ServerResponse JSON body (two-level
 * parse and bad-request replies live in the shipped handler, not the
 * bridge). The socket path here pins the row's naming (runtime.ts) like the
 * ready-marker spec pins the ready line: a rename fails loudly instead of
 * silently breaking the data channel.
 */
const SOCKET_PATH = join(state.profileDir, "run", `next-app-${state.port}.sock`);

/** The response-frame shape the assertions read (structural; the e2e package carries no apiproxy types). */
interface ResponseFrame {
  type: string;
  rpcId: string;
  result: { ok: boolean; value?: { items?: unknown[] }; error?: { code?: string } };
}

test("the runtime row serves the bridge socket with mode 0600", () => {
  // The socket's filesystem permissions are its access control (ADR-0003):
  // no other user on the machine may address the profile's gateway.
  const stat = statSync(SOCKET_PATH);
  expect(stat.isSocket()).toBe(true);
  expect(stat.mode & 0o777).toBe(0o600);
});

test("session.list answers with a server-response frame echoing the rpcId", async () => {
  const rpcId = "e2e-list-" + randomUUID();
  const response = await httpPost(
    SOCKET_PATH,
    "/api/session.list",
    JSON.stringify({ type: "client-request", rpcId, method: "session.list", payload: {} }),
  );
  expect(response.status).toBe(200);
  const frame = JSON.parse(response.body) as ResponseFrame;
  expect(frame.type).toBe("server-response");
  expect(frame.rpcId).toBe(rpcId);
  expect(frame.result.ok).toBe(true);
  // The fresh scratch profile has no sessions: the value parses as an empty
  // items list (the wire shape, not a made-up fallback).
  expect(Array.isArray(frame.result.value?.items)).toBe(true);
});

test("an unknown method is a transport-level 404", async () => {
  // The shipped handler serves only the methods the gateway contract knows;
  // an unknown path is the carrier's "not found", exactly as over HTTP.
  const response = await httpPost(
    SOCKET_PATH,
    "/api/session.nope",
    JSON.stringify({
      type: "client-request",
      rpcId: "e2e-unknown",
      method: "session.nope",
      payload: {},
    }),
  );
  expect(response.status).toBe(404);
});

test("a payload failing the method's schema is answered with a bad-request error", async () => {
  // session.list's payload schema allows only an optional string cursor; a
  // number is a second-level parse failure in the shipped handler, reported
  // on the request's rpcId with a 200 (business errors never ride the HTTP
  // status - the envelope carries them).
  const rpcId = "e2e-payload-" + randomUUID();
  const response = await httpPost(
    SOCKET_PATH,
    "/api/session.list",
    JSON.stringify({
      type: "client-request",
      rpcId,
      method: "session.list",
      payload: { cursor: 42 },
    }),
  );
  expect(response.status).toBe(200);
  const frame = JSON.parse(response.body) as ResponseFrame;
  expect(frame.type).toBe("server-response");
  expect(frame.rpcId).toBe(rpcId);
  expect(frame.result.ok).toBe(false);
  expect(frame.result.error?.code).toBe("bad-request");
});

test("a non-JSON body is a carrier-level 400", async () => {
  const response = await httpPost(SOCKET_PATH, "/api/session.list", "this is not json");
  expect(response.status).toBe(400);
});

test("a malformed envelope is answered with a bad-request error on the salvaged rpcId", async () => {
  // The envelope fails the shipped client-request schema (method must be a
  // string); the handler salvages the frame's string rpcId so the error
  // reply stays correlatable - the sentinel invalid-request applies only
  // when no id is readable.
  const response = await httpPost(
    SOCKET_PATH,
    "/api/session.list",
    JSON.stringify({ type: "client-request", rpcId: "e2e-malformed", method: 42 }),
  );
  expect(response.status).toBe(200);
  const frame = JSON.parse(response.body) as ResponseFrame;
  expect(frame.type).toBe("server-response");
  expect(frame.rpcId).toBe("e2e-malformed");
  expect(frame.result.ok).toBe(false);
  expect(frame.result.error?.code).toBe("bad-request");
});
