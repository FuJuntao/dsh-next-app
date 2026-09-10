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
 * Sanity ceiling on the derived wall. The wall exists to be a backstop, not a
 * door: a mirror that drifted (or a retuned deployment with an absurd
 * projection) must not silently size it past any meaning. 1 GiB is about 2x
 * what the shipped defaults derive today, so hitting it means the input is
 * wrong rather than the product having grown.
 */
export const BODY_SIZE_LIMIT_CEILING_BYTES = 1024 * 1024 * 1024;

/**
 * The server-action body cap (a Next SizeLimit string like "28mb") that
 * admits the host's fullest legal image message with base64 headroom:
 * `maxImagesPerMessage x maxImageBytes x 1.37`, rounded up to whole KiB and
 * clamped at BODY_SIZE_LIMIT_CEILING_BYTES. The client pre-check is the UX;
 * this cap is the wall. With no attachment service composed there is no
 * image payload to size, so a conservative floor (the old default widened for
 * text) applies - the host still refuses oversized prompts at admission.
 */
export function deriveBodySizeLimit(limits: ImageAttachmentLimits | undefined): string {
  if (limits === undefined) return "8mb";
  const raw = Math.ceil(limits.maxImagesPerMessage * limits.maxImageBytes * BASE64_HEADROOM);
  if (raw > BODY_SIZE_LIMIT_CEILING_BYTES) {
    // Loud, because the clamp is the mirror being wrong: name the input that
    // tripped it rather than shipping a wall that quietly stopped being one.
    console.warn(
      `[body-limit] derived ${String(raw)} bytes exceeds the ` +
        `${String(BODY_SIZE_LIMIT_CEILING_BYTES / (1024 * 1024))}mb ceiling; ` +
        `clamped. Check HOST_DEFAULT_IMAGE_LIMITS against the pinned ` +
        `@deepseek-ai/dsh-attachment-local defaults, or set DSH_NEXT_APP_BODY_SIZE_LIMIT.`,
    );
  }
  const bytes = Math.min(raw, BODY_SIZE_LIMIT_CEILING_BYTES);
  const roundedKib = Math.ceil(bytes / KIB) * KIB;
  if (roundedKib >= 1024 * KIB) {
    const mib = Math.ceil(roundedKib / (1024 * KIB));
    return `${String(mib)}mb`;
  }
  return `${String(roundedKib / KIB)}kb`;
}

/**
 * The image types this deployment's attachment service accepts, single-source
 * for the intake pre-check and the attachment read route's `Content-Type`
 * echo. The host keeps its own copy internal (no export), so this is the one
 * number-ish fact here that cannot be drift-guarded mechanically - it is
 * re-checked by hand when the pinned range bumps, and both of our copies read
 * it from here so at least they cannot drift APART (the route imports it).
 */
export const ATTACHMENT_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/**
 * The deployment's shipped attachment-service defaults - a MIRROR of
 * `@deepseek-ai/dsh-attachment-local`'s exported `DEFAULT_MAX_*` constants,
 * restated as literals because `next.config.ts` imports this module and the
 * staged build ships config + this file only, so nothing here may reach into
 * a host package. The mirror is pinned mechanically by
 * `lib/body-limit.test.ts`, which imports the host's own constants and
 * asserts equality: a host default bump fails that test instead of silently
 * mis-sizing the wall. A deployment that retunes the values overrides the
 * derived cap through DSH_NEXT_APP_BODY_SIZE_LIMIT.
 */
export const HOST_DEFAULT_IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 20 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 200 * 1024 * 1024,
  maxImagePixels: 64_000_000,
  maxImageDimension: 8192,
  mediaTypes: ATTACHMENT_MEDIA_TYPES,
};
