/**
 * web-startup - the next-app server row (scaffold).
 *
 * Runs inside the dsh host process when the `next-app` profile starts
 * (ADR-0001): spawns `next start` from the packed .next output through
 * the `subprocess` service, detects readiness from the child's stdout,
 * restarts it with backoff on unexpected exit, terminates its tree on
 * stop, and owns the mode-0600 unix-socket listener that bridges the
 * /api envelope to the gateway's transport-agnostic seams (ADR-0003).
 *
 * Import surface: host packages only (resolved from the user's dsh
 * installation as peerDependencies). The version pin and boot
 * invariant land with the bridge story. The real implementation lands
 * with the runtime glue stories.
 */
export function webStartup(): never {
  throw new Error("web-startup: not implemented yet (scaffold placeholder)");
}
