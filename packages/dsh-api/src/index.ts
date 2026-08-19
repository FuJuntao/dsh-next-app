export { SUPPORTED_DSH_VERSION } from "./version.js";
export { assertDshVersion } from "./assert-dsh-version.js";
export { createDshClient } from "./client.js";
export type { DshTransport } from "./client.js";
export { TrustFenceError } from "./trust-fence.js";
export { ConnectionController } from "./connection.js";
export type {
  ConnectionConfig,
  ConnectionSinks,
  ConnectionState,
  HostDescription,
} from "./connection.js";

/**
 * Typed domain tree of the dsh /api gateway protocol, re-exported from the
 * sole upstream runtime dependency (exact-pinned per ADR-0006):
 * - the domain Api interfaces and payload types, the four-quadrant RPC
 *   envelope types, and MuxFrame/HostFrame from the /api contract barrel;
 * - IApiClient, the payload-direct client consumption face, from /client;
 * - the frame schemas (zod discriminated unions) as values from
 *   api/events.schema, for stream-frame parsing.
 * Value seams the client builds on (AbstractApiClient, RpcId, transportError)
 * stay direct upstream imports of the modules that use them.
 */
export type * from "@deepseek-ai/dsh-host-apiproxy/api";
export type { IApiClient } from "@deepseek-ai/dsh-host-apiproxy/client";
export { hostFrameSchema, muxFrameSchema } from "@deepseek-ai/dsh-host-apiproxy/api/events.schema";
