/**
 * The server-action body-limit derivation (story #134 task #135 commit 9,
 * AC 19) - its OWN module because next.config.ts imports it and the staged
 * app build ships config + this file only (packages/dsh-next-app
 * tsdown.config.ts stageWebBuild); anything it pulled from would have to
 * ship too. lib/image-intake.ts re-exports it for app consumers, so the
 * derivation stays single-source.
 */

/**
 * The host's image-intake limits (the dsh-attachment `ImageAttachmentLimits`
 * wire shape, mirrored structurally - see lib/image-intake.ts).
 */
export interface ImageAttachmentLimits {
  maxImageBytes: number;
  maxImagesPerMessage: number;
  maxMessageImageBytes: number;
  maxImagePixels: number;
  maxImageDimension: number;
  mediaTypes: readonly string[];
}

/** Base64 expansion is at most ceil(n/3)*4; 1.37 (rounded-up bytes) is the headroom. */
const BASE64_HEADROOM = 1.37;
const KIB = 1024;

/**
 * The server-action body cap (a Next SizeLimit string like "28mb") that
 * admits the host's fullest legal image message with base64 headroom:
 * `maxImagesPerMessage x maxImageBytes x 1.37`, rounded up to whole KiB.
 * The client pre-check is the UX; this cap is the wall. With no attachment
 * service composed there is no image payload to size, so a conservative
 * floor (the old default widened for text) applies - the host still
 * refuses oversized prompts at admission.
 */
export function deriveBodySizeLimit(limits: ImageAttachmentLimits | undefined): string {
  if (limits === undefined) return "8mb";
  const bytes = Math.ceil(limits.maxImagesPerMessage * limits.maxImageBytes * BASE64_HEADROOM);
  const roundedKib = Math.ceil(bytes / KIB) * KIB;
  if (roundedKib >= 1024 * KIB) {
    const mib = Math.ceil(roundedKib / (1024 * KIB));
    return `${String(mib)}mb`;
  }
  return `${String(roundedKib / KIB)}kb`;
}

/**
 * The deployment's shipped attachment-service defaults - the numbers the
 * next-app profile's imageLimits projection carries unless the operator
 * retunes them. next.config.ts sizes the body cap from these; a deployment
 * that retunes them overrides the derived cap through
 * DSH_NEXT_APP_BODY_SIZE_LIMIT.
 */
export const HOST_DEFAULT_IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 20 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 200 * 1024 * 1024,
  maxImagePixels: 64_000_000,
  maxImageDimension: 8192,
  mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
};
