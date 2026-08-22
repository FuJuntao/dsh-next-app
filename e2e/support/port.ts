import net from "node:net";

/** Reserve a free loopback port and release it for the caller to bind. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("no numeric address from the port probe"));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}
