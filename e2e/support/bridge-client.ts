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
