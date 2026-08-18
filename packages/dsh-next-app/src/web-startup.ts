/**
 * web-startup - placeholder glue.
 *
 * At runtime this boots the built Next.js app (apps/web output copied in
 * at pack time per ADR-0007) inside the dsh next-app profile, importing
 * only next, react, react-dom, and its own helpers - never workspace
 * members. The real implementation lands with the runtime glue stories.
 */
export function webStartup(): never {
  throw new Error("web-startup: not implemented yet (scaffold placeholder)");
}
