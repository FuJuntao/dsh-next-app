#!/usr/bin/env node
/**
 * Golden wire transcript capture for the dsh /api gateway protocol.
 *
 * Records the wire facts the dsh-api client covers (AC 6 of issue #39) as
 * JSONL fixtures under packages/dsh-api/fixtures/wire/, replayed by
 * src/wire-replay.test.ts - 'pnpm test' never needs a live host.
 *
 * Provenance model (every record carries it):
 * - live-http        request/response bytes verbatim from a scratch-booted
 *                    dsh host (isolated $DSH_HOME under the scratch dir -
 *                    never the shared ~/.dsh; the scratch home is created
 *                    empty, so no credentials or secrets can leak into the
 *                    fixtures).
 * - live-ws-downlink frames read from the host's in-box WebSocket downlinks.
 *                    dsh 0.1.0-rc.7 serves the event streams over WebSocket
 *                    to its in-box client; the SSE carrier is upstream's
 *                    toFetchHandler/readSse pair (mounted by this bundle's
 *                    web-startup glue in a later story).
 * - upstream-emitter SSE bytes produced by the pinned dsh-host-apiproxy's
 *                    own toFetchHandler around live-captured frames.
 * - mock-edge        trust-error statuses the rc.7 host never emits (401
 *                    belongs to this app's ADR-0004 basic-auth gate),
 *                    recorded through a minimal in-script transport-edge
 *                    mock, as the task brief sanctions.
 * - synthetic        representative bridge heartbeat comment lines (ADR-0003
 *                    heartbeats belong to this app's downlink bridge, not to
 *                    dsh rc.7, whose emitter sends only ': connected').
 *
 * Usage: node packages/dsh-api/scripts/capture-wire-transcripts.mjs
 *
 * Needs: network access to the npm registry and scratch-writable temp space.
 * In environments with a read-only $HOME the script already redirects every
 * tool cache (npm/pnpm/corepack/XDG) into its scratch dir.
 */
import { execFile, spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..");
const fixturesDir = path.join(packageRoot, "fixtures", "wire");

/** The dsh version this package is pinned to (single source of truth). */
const versionSource = await readFile(path.join(packageRoot, "src", "version.ts"), "utf8");
const pinMatch = /SUPPORTED_DSH_VERSION\s*=\s*"([^"]+)"/u.exec(versionSource);
if (pinMatch === null || pinMatch[1] === undefined) {
  throw new Error(
    "capture-wire-transcripts: cannot read SUPPORTED_DSH_VERSION from src/version.ts",
  );
}
const PIN = pinMatch[1];

const HOST_BIND = "127.0.0.1";
const UNTRUSTED_HOST = "untrusted.example";
const log = (line) => console.log("[capture-wire] " + line);

// ---------------------------------------------------------------------------
// scratch install: dsh@PIN with the whole @deepseek-ai train pinned to PIN
// ---------------------------------------------------------------------------

function npmEnv(scratch) {
  return {
    ...process.env,
    npm_config_cache: path.join(scratch, "npm-cache"),
  };
}

async function npmInstall(scratch) {
  await execFileP("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: scratch,
    env: npmEnv(scratch),
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Every @deepseek-ai package name present anywhere in the tree. */
async function collectDeepseekNames(scratch) {
  const names = new Set();
  async function walkNodeModules(dir, depth) {
    if (depth > 5) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.name === "@deepseek-ai") {
        for (const scoped of await readdir(entryPath)) names.add(scoped);
        continue;
      }
      if (entry.name.startsWith(".")) continue;
      await walkNodeModules(path.join(entryPath, "node_modules"), depth + 1);
    }
  }
  await walkNodeModules(path.join(scratch, "node_modules"), 0);
  return [...names].sort();
}

let currentScratch = "";

async function publishesVersion(name, version) {
  try {
    await execFileP("npm", ["view", "@deepseek-ai/" + name + "@" + version, "version"], {
      env: npmEnv(currentScratch),
      timeout: 60_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function installPinnedClosure(scratch) {
  currentScratch = scratch;
  const manifest = {
    name: "dsh-wire-capture-scratch",
    private: true,
    dependencies: { "@deepseek-ai/dsh": PIN },
  };
  await writeFile(path.join(scratch, "package.json"), JSON.stringify(manifest, null, 2));
  log("pass 1: bare install of dsh@" + PIN + " (caret ranges may float)");
  await npmInstall(scratch);

  const names = await collectDeepseekNames(scratch);
  log("checking " + names.length + " @deepseek-ai packages for an exact " + PIN);
  const verdicts = await Promise.all(
    names.map(async (name) => [name, await publishesVersion(name, PIN)]),
  );
  const overrides = {};
  for (const [name, available] of verdicts) {
    if (available) overrides["@deepseek-ai/" + name] = PIN;
  }
  manifest.overrides = overrides;
  await writeFile(path.join(scratch, "package.json"), JSON.stringify(manifest, null, 2));
  // clean reify: reinstalling over the floated tree sends npm's ideal-tree
  // computation into a spin; a fresh install with the override manifest is
  // both fast and deterministic
  await rm(path.join(scratch, "node_modules"), { recursive: true, force: true });
  await rm(path.join(scratch, "package-lock.json"), { force: true });
  log("pass 2: clean install with " + Object.keys(overrides).length + " exact pins");
  await npmInstall(scratch);

  const { stdout } = await execFileP(path.join(scratch, "node_modules", ".bin", "dsh"), [
    "--version",
  ]);
  const bootedCli = stdout.trim();
  if (bootedCli !== PIN) {
    throw new Error("capture-wire-transcripts: expected dsh " + PIN + ", installed " + bootedCli);
  }
  log("dsh " + bootedCli + " installed");

  // The transcripts encode the emitter/frame semantics of exactly this
  // package, so its closure version is asserted too: a registry timeout in
  // the availability check above could otherwise leave it unpinned.
  const apiproxyManifest = JSON.parse(
    await readFile(
      path.join(scratch, "node_modules", "@deepseek-ai", "dsh-host-apiproxy", "package.json"),
      "utf8",
    ),
  );
  if (apiproxyManifest.version !== PIN) {
    throw new Error(
      "capture-wire-transcripts: expected dsh-host-apiproxy " +
        PIN +
        ", installed " +
        String(apiproxyManifest.version),
    );
  }
  log("dsh-host-apiproxy " + String(apiproxyManifest.version) + " matches the pin");
}

// ---------------------------------------------------------------------------
// scratch host boot
// ---------------------------------------------------------------------------

function bootHost(scratch) {
  const dshHome = path.join(scratch, "dsh-home");
  const env = {
    ...npmEnv(scratch),
    DSH_HOME: dshHome,
    PNPM_HOME: path.join(scratch, "pnpm-home"),
    XDG_DATA_HOME: path.join(scratch, "xdg-data"),
    XDG_CACHE_HOME: path.join(scratch, "xdg-cache"),
    XDG_CONFIG_HOME: path.join(scratch, "xdg-config"),
    BROWSER: "true", // headless: the browser-open attempt becomes a no-op
  };
  const child = spawn(
    path.join(scratch, "node_modules", ".bin", "dsh"),
    ["web", "--host", HOST_BIND, "--port", "0"],
    {
      cwd: scratch,
      env,
    },
  );
  const settled = new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      reject(new Error("dsh web did not print its URL within 180s\n" + buffer));
    }, 180_000);
    const onData = (chunk) => {
      buffer += String(chunk);
      const match = /http:\/\/[^\s]+/u.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("dsh web exited early (code " + code + ")\n" + buffer));
    });
  });
  return { child, url: settled, home: dshHome };
}

async function awaitReady(baseUrl) {
  const body = JSON.stringify({
    type: "client-request",
    rpcId: "readiness",
    method: "host.describe",
    payload: {},
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(baseUrl + "/api/host.describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      if (res.status === 200) return JSON.parse(await res.text());
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("capture-wire-transcripts: host never became ready");
}

// ---------------------------------------------------------------------------
// capture primitives
// ---------------------------------------------------------------------------

async function captureUnary(baseUrl, method, payload, rpcId) {
  const body = JSON.stringify({ type: "client-request", rpcId, method, payload });
  const res = await fetch(baseUrl + "/api/" + method, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return {
    request: { method: "POST", path: "/api/" + method, contentType: "application/json", body },
    response: {
      status: res.status,
      contentType: res.headers.get("content-type"),
      body: await res.text(),
    },
  };
}

/** Raw HTTP request with caller-controlled headers (fetch forbids Host). */
function rawRequest(port, { method, path: urlPath, headers, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST_BIND, port, method, path: urlPath, headers: { ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Raw-socket capture of an upgrade request answered before negotiation. */
function rawUpgradeBytes(port, urlPath, hostHeader) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, HOST_BIND);
    let buffer = "";
    const request = [
      "GET " + urlPath + " HTTP/1.1",
      "Host: " + hostHeader,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n");
    socket.on("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
    });
    socket.on("end", () => resolve(buffer));
    socket.on("error", reject);
    setTimeout(() => socket.destroy(), 5000);
  });
}

/** Collect raw text messages from an in-box WebSocket downlink. */
function collectWsFrames(url, ms) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const ws = new WebSocket(url);
    const timer = setTimeout(() => ws.close(), ms);
    ws.addEventListener("message", (event) => frames.push(String(event.data)));
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      resolve(frames);
    });
    ws.addEventListener("error", (event) => {
      clearTimeout(timer);
      reject(new Error("websocket error on " + url + ": " + String(event.message ?? "unknown")));
    });
  });
}

/** Narrow (rpcId, payload) view of the full-form frames the downlink sends. */
function narrowOf(fullFrames) {
  return fullFrames.map((frame) => ({ rpcId: frame.rpcId, payload: frame.payload }));
}

/** SSE bytes from the pinned upstream emitter around captured live frames. */
async function captureSse(scratch, streamPath, narrowFrames, induceFailure) {
  const apiproxyUrl = pathToFileURL(
    path.join(scratch, "node_modules", "@deepseek-ai", "dsh-host-apiproxy", "lib", "index.js"),
  ).href;
  const { toFetchHandler } = await import(apiproxyUrl);
  async function* frames() {
    for (const frame of narrowFrames) yield frame;
    if (induceFailure) throw new Error("capture: induced stream failure");
  }
  const api = {
    events: {
      mux: (_request, _signal) => {
        if (streamPath !== "/api/events.mux") throw new Error("capture: unexpected mux open");
        return frames();
      },
      host: (_request, _signal) => {
        if (streamPath !== "/api/events.host") throw new Error("capture: unexpected host open");
        return frames();
      },
    },
  };
  const handler = toFetchHandler(api);
  const res = await handler.fetch(new Request("http://capture.local" + streamPath));
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    raw: await res.text(),
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const scratch = await mkdtemp(path.join(os.tmpdir(), "dsh-wire-capture-"));
log("scratch dir: " + scratch);
let host;
try {
  await installPinnedClosure(scratch);

  log("booting scratch host (isolated DSH_HOME: " + path.join(scratch, "dsh-home") + ")");
  await mkdir(path.join(scratch, "dsh-home"), { recursive: true });
  host = bootHost(scratch);
  const baseUrl = await host.url;
  log("host URL: " + baseUrl);
  const port = Number(new URL(baseUrl).port);
  const readiness = await awaitReady(baseUrl);
  log("host ready: " + readiness.result.value.version + " at " + readiness.result.value.cwd);

  const capturedAt = new Date().toISOString();
  const unaryRecords = [];
  const streamRecords = [];
  const trustRecords = [];
  const meta = {
    kind: "meta",
    dshVersion: PIN,
    capturedAt,
    host: {
      describeValue: readiness.result.value,
      note: "fresh scratch DSH_HOME: no sessions, workspaces, or credentials configured at capture time",
    },
  };

  // ---- unary quadrants (client-request -> server-response) ----------------
  for (const [name, method, payload, rpcId] of [
    ["host-describe-ok", "host.describe", {}, "cap-describe"],
    ["session-list-ok", "session.list", {}, "cap-session-list"],
    ["workspace-list-ok", "workspace.list", {}, "cap-workspace-list"],
  ]) {
    const transcript = await captureUnary(baseUrl, method, payload, rpcId);
    unaryRecords.push({
      kind: "unary",
      name,
      quadrant: "client-request->server-response",
      result: "ok",
      provenance: "live-http",
      ...transcript,
    });
  }
  {
    const transcript = await captureUnary(baseUrl, "session.create", {}, "cap-session-create");
    unaryRecords.push({
      kind: "unary",
      name: "session-create-ok",
      quadrant: "client-request->server-response",
      result: "ok",
      provenance: "live-http",
      ...transcript,
    });
  }
  {
    // business error stays in the RpcResult error slot (never thrown)
    const transcript = await captureUnary(
      baseUrl,
      "session.create",
      { agentPreset: "no-such-preset" },
      "cap-preset-error",
    );
    unaryRecords.push({
      kind: "unary",
      name: "session-create-agent-preset-not-found",
      quadrant: "client-request->server-response",
      result: "business-error",
      provenance: "live-http",
      ...transcript,
    });
  }
  {
    // invalid client-request envelopes: HTTP 200 + bad-request in the result slot
    const missing = await (async () => {
      const res = await fetch(baseUrl + "/api/host.describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return {
        request: {
          method: "POST",
          path: "/api/host.describe",
          contentType: "application/json",
          body: "{}",
        },
        response: {
          status: res.status,
          contentType: res.headers.get("content-type"),
          body: await res.text(),
        },
      };
    })();
    unaryRecords.push({
      kind: "unary",
      name: "invalid-envelope-missing-fields",
      quadrant: "client-request->server-response",
      result: "invalid-envelope",
      provenance: "live-http",
      ...missing,
    });
    const badRpcIdBody = JSON.stringify({
      type: "client-request",
      rpcId: 123,
      method: "host.describe",
      payload: {},
    });
    const badRpcId = await (async () => {
      const res = await fetch(baseUrl + "/api/host.describe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: badRpcIdBody,
      });
      return {
        request: {
          method: "POST",
          path: "/api/host.describe",
          contentType: "application/json",
          body: badRpcIdBody,
        },
        response: {
          status: res.status,
          contentType: res.headers.get("content-type"),
          body: await res.text(),
        },
      };
    })();
    unaryRecords.push({
      kind: "unary",
      name: "invalid-envelope-rpc-id-not-string",
      quadrant: "client-request->server-response",
      result: "invalid-envelope",
      provenance: "live-http",
      ...badRpcId,
    });
  }

  // ---- carrier statuses (not RpcMessages: HTTP describes only the carrier)
  {
    const res = await fetch(baseUrl + "/api/host.describe", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "not json",
    });
    unaryRecords.push({
      kind: "carrier",
      name: "unsupported-content-type",
      provenance: "live-http",
      request: {
        method: "POST",
        path: "/api/host.describe",
        contentType: "text/plain",
        body: "not json",
      },
      response: {
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: await res.text(),
      },
    });
    const res404 = await fetch(baseUrl + "/api/no.such.method", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    unaryRecords.push({
      kind: "carrier",
      name: "unknown-path",
      provenance: "live-http",
      request: {
        method: "POST",
        path: "/api/no.such.method",
        contentType: "application/json",
        body: "{}",
      },
      response: {
        status: res404.status,
        contentType: res404.headers.get("content-type"),
        body: await res404.text(),
      },
    });
  }

  // ---- client-response quadrant (POST /api/respond -> RpcReceipt) ---------
  {
    const body = JSON.stringify({
      type: "client-response",
      rpcId: "cap-respond",
      result: { ok: true, value: {} },
    });
    const res = await fetch(baseUrl + "/api/respond", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    unaryRecords.push({
      kind: "respond",
      name: "respond-not-pending",
      quadrant: "client-response->receipt",
      provenance: "live-http",
      request: { method: "POST", path: "/api/respond", contentType: "application/json", body },
      response: {
        status: res.status,
        contentType: res.headers.get("content-type"),
        body: await res.text(),
      },
    });
  }

  // ---- trust fence, live: untrusted Host authority -> 403 ------------------
  {
    const fenceBody = JSON.stringify({
      type: "client-request",
      rpcId: "cap-fence",
      method: "host.describe",
      payload: {},
    });
    const unaryFence = await rawRequest(port, {
      method: "POST",
      path: "/api/host.describe",
      headers: {
        "content-type": "application/json",
        host: UNTRUSTED_HOST,
        "content-length": Buffer.byteLength(fenceBody),
      },
      body: fenceBody,
    });
    trustRecords.push({
      kind: "trust",
      name: "unary-403-untrusted-host",
      leg: "unary",
      status: 403,
      provenance: "live-http",
      request: { method: "POST", path: "/api/host.describe", hostHeader: UNTRUSTED_HOST },
      response: {
        status: unaryFence.status,
        contentType: unaryFence.headers["content-type"],
        body: unaryFence.body,
      },
    });
    const streamFence = await rawRequest(port, {
      method: "GET",
      path: "/api/events.mux",
      headers: { host: UNTRUSTED_HOST },
    });
    trustRecords.push({
      kind: "trust",
      name: "stream-open-403-untrusted-host",
      leg: "stream-open",
      status: 403,
      provenance: "live-http",
      request: { method: "GET", path: "/api/events.mux", hostHeader: UNTRUSTED_HOST },
      response: {
        status: streamFence.status,
        contentType: streamFence.headers["content-type"],
        body: streamFence.body,
      },
    });
    const upgradeFence = await rawUpgradeBytes(port, "/api/events.mux", UNTRUSTED_HOST);
    trustRecords.push({
      kind: "trust",
      name: "ws-upgrade-403-untrusted-host",
      leg: "ws-upgrade",
      status: 403,
      provenance: "live-raw-socket",
      request: {
        method: "GET",
        path: "/api/events.mux",
        hostHeader: UNTRUSTED_HOST,
        upgrade: "websocket",
      },
      raw: upgradeFence,
    });
  }

  // ---- trust fence, mock edge: 401 (rc.7 emits only 403; the 401 belongs to
  // this app's future ADR-0004 basic-auth gate - sanctioned in-script mock) --
  trustRecords.push({
    kind: "trust",
    name: "unary-401-bare",
    leg: "unary",
    status: 401,
    provenance: "mock-edge",
    request: { method: "POST", path: "/api/host.describe" },
    response: { status: 401, contentType: null, headers: {}, body: "" },
  });
  trustRecords.push({
    kind: "trust",
    name: "unary-401-basic-auth-challenge",
    leg: "unary",
    status: 401,
    provenance: "mock-edge",
    request: { method: "POST", path: "/api/host.describe" },
    response: {
      status: 401,
      contentType: null,
      headers: { "www-authenticate": 'Basic realm="dsh"' },
      body: "",
    },
  });

  // ---- live frames over the in-box WebSocket downlinks ---------------------
  const wsBase = "ws://" + HOST_BIND + ":" + port;
  const hostStream = collectWsFrames(wsBase + "/api/events.host", 4000);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const created = await captureUnary(baseUrl, "session.create", {}, "cap-frame-session");
  const createdValue = JSON.parse(created.response.body).result.value;
  log("created session " + createdValue.sessionId + " for frame capture");
  const hostFrames = (await hostStream).map((line) => JSON.parse(line));

  const muxFrames = (await collectWsFrames(wsBase + "/api/events.mux", 2500)).map((line) =>
    JSON.parse(line),
  );

  // best-effort enrichment: prompt with no provider credentials configured -
  // records whatever frames/envelopes the deterministic failure produces
  const enrichment = { unary: [], mux: [], host: [] };
  try {
    const hostExtra = collectWsFrames(wsBase + "/api/events.host", 5000);
    const muxExtra = collectWsFrames(wsBase + "/api/events.mux", 5000);
    const prompt = await captureUnary(
      baseUrl,
      "session.prompt",
      {
        sessionId: createdValue.sessionId,
        mode: "queue",
        content: [{ type: "text", text: "wire capture probe" }],
      },
      "cap-prompt",
    );
    enrichment.unary.push(prompt);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    enrichment.mux = (await muxExtra).map((line) => JSON.parse(line));
    enrichment.host = (await hostExtra).map((line) => JSON.parse(line));
  } catch (error) {
    log("enrichment step skipped: " + String(error));
  }

  streamRecords.push({
    kind: "ws-frames",
    name: "host-session-lifecycle",
    stream: "host",
    provenance: "live-ws-downlink",
    frames: hostFrames,
    note: "captured while session.create ran against the fresh host",
  });
  streamRecords.push({
    kind: "ws-frames",
    name: "mux-subscribed",
    stream: "mux",
    provenance: "live-ws-downlink",
    frames: muxFrames,
    note: "subscription baseline for the one attached session",
  });
  streamRecords.push({
    kind: "ws-frames",
    name: "prompt-failure-enrichment",
    stream: "mux+host",
    provenance: "live-ws-downlink",
    frames: [...enrichment.mux, ...enrichment.host],
    unary: enrichment.unary,
    note: "best-effort: session.prompt with no provider credentials configured; whatever arrived is recorded",
  });

  // ---- SSE transcripts from the pinned upstream emitter ---------------------
  const muxSse = await captureSse(scratch, "/api/events.mux", narrowOf(muxFrames), false);
  streamRecords.push({
    kind: "sse",
    name: "events-mux",
    stream: "mux",
    provenance: "upstream-emitter+live-frames",
    response: { status: muxSse.status, contentType: muxSse.contentType },
    raw: muxSse.raw,
    frames: narrowOf(muxFrames),
    note:
      "bytes produced by dsh-host-apiproxy@" +
      PIN +
      " toFetchHandler around live-captured mux frames",
  });
  const hostSse = await captureSse(scratch, "/api/events.host", narrowOf(hostFrames), false);
  streamRecords.push({
    kind: "sse",
    name: "events-host",
    stream: "host",
    provenance: "upstream-emitter+live-frames",
    response: { status: hostSse.status, contentType: hostSse.contentType },
    raw: hostSse.raw,
    frames: narrowOf(hostFrames),
    note:
      "bytes produced by dsh-host-apiproxy@" +
      PIN +
      " toFetchHandler around live-captured host frames",
  });
  const errorSse = await captureSse(scratch, "/api/events.mux", narrowOf(muxFrames), true);
  streamRecords.push({
    kind: "sse",
    name: "events-mux-stream-error",
    stream: "mux",
    provenance: "upstream-emitter+induced-failure",
    response: { status: errorSse.status, contentType: errorSse.contentType },
    raw: errorSse.raw,
    frames: narrowOf(muxFrames),
    note: "an impl throw mid-stream emits one stream/error frame then closes (upstream emitter semantics)",
  });

  // ---- heartbeats: captured non-frame lines + labeled synthetic bridge lines
  streamRecords.push({
    kind: "heartbeats",
    name: "non-frame-lines",
    provenance: "captured+synthetic",
    captured: [": connected"],
    syntheticBridge: [": heartbeat", ": keepalive"],
    note: "rc.7's emitter sends only the ': connected' greeting; periodic heartbeats belong to this app's ADR-0003 downlink bridge (a later story) - the synthetic lines stand in for them, clearly labeled",
  });

  // ---- write fixtures --------------------------------------------------------
  await mkdir(fixturesDir, { recursive: true });
  const files = {
    "unary.jsonl": [meta, ...unaryRecords],
    "streams.jsonl": [
      { ...meta, note: "see unary.jsonl meta for the shared capture context" },
      ...streamRecords,
    ],
    "trust.jsonl": [
      { ...meta, note: "see unary.jsonl meta for the shared capture context" },
      ...trustRecords,
    ],
  };
  for (const [file, records] of Object.entries(files)) {
    const text = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    await writeFile(path.join(fixturesDir, file), text);
    log("wrote fixtures/wire/" + file + " (" + records.length + " records)");
  }
  log(
    "done: dsh " +
      PIN +
      ", " +
      (unaryRecords.length + streamRecords.length + trustRecords.length) +
      " records",
  );
} finally {
  if (host !== undefined) {
    host.child.kill("SIGTERM");
    await new Promise((resolve) => {
      host.child.once("exit", resolve);
      setTimeout(resolve, 5000);
    });
  }
  await rm(scratch, { recursive: true, force: true });
  log("scratch removed");
}
