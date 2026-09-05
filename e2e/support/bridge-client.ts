import { request as httpRequest } from "node:http";

/**
 * One raw HTTP round-trip over a bridge unix socket (ADR-0003 socket
 * lifecycle, ADR-0010 framing): POST <path> with the given body to the
 * socket, answered with the response's status and body.
 *
 * The form stays deliberately raw so specs can assert carrier failures
 * (non-JSON bodies, refused connects) and envelope framing alike; both
 * bridge.spec.ts (the socket contract) and sessions.spec.ts (seeding and
 * wire-order reads) speak through it.
 */
export function httpPost(
  socketPath: string,
  path: string,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        socketPath,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: data });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Open the mux stream (`GET /api/events.mux`) over the bridge socket and
 * report each ServerRequest frame (`{rpcId, payload}`) as it arrives.
 * Deliberately raw like httpPost: the live specs (task #135) assert the
 * envelope the row carries, and a close handle must be able to abort the
 * long-lived connection mid-spec without killing the profile.
 */
export function openMux(
  socketPath: string,
  onFrame: (frame: { rpcId: string; payload: Record<string, unknown> }) => void,
): { close(): void } {
  const req = httpRequest(
    {
      socketPath,
      path: "/api/events.mux",
      method: "GET",
      headers: { accept: "text/event-stream" },
    },
    (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        for (;;) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary === -1) break;
          const record = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = record
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice("data: ".length))
            .join("");
          if (data === "") continue; // comment records (the bridge's own heartbeat)
          try {
            const parsed = JSON.parse(data) as {
              rpcId: string;
              payload: Record<string, unknown>;
            };
            onFrame(parsed);
          } catch {
            // A frame this helper cannot parse is the carrier's problem to
            // report; the live specs assert domain shapes it already yields.
          }
        }
      });
    },
  );
  req.on("error", () => {
    // A dropped mux connection ends the handle; specs reconnect by opening
    // a fresh one (resubscribe + re-sync, ADR-0003).
  });
  req.end();
  return {
    close() {
      req.destroy();
    },
  };
}
