/**
 * Image intake pre-checks and the server-action body limit (story #134
 * task #135 commit 9; AC 18/19) - pure, shared by the composer (client
 * pre-check UX) and next.config.ts (server backstop), so the two never
 * disagree about what a prompt may carry.
 *
 * The host's `imageLimits` projection (from the attachments service config)
 * is the authority; the browser pre-checks against it at INTAKE and shows a
 * refusal before submitting, but the HOST still answers admission - a
 * pre-check is UX, not a trust boundary. Absent limits (no attachment
 * service composed) means skip every pre-check and let the host answer.
 *
 * The body limit is DERIVED from the projected limits with base64 headroom:
 * a prompt's images ride base64 in the server-action payload, and Next caps
 * server-action bodies (1 MiB default) well under the image caps. The
 * derivation is `maxImagesPerMessage x maxImageBytes x headroom`, rounded up
 * to a whole KiB - the client pre-check is the courtesy, this cap is the
 * wall, and the headroom covers base64's ~4/3 expansion (37%).
 */
/**
 * The host's image-intake limits, as the `imageLimits` projection carries
 * them (the dsh-attachment `ImageAttachmentLimits` wire shape, mirrored
 * structurally so the client bundle carries no attachment-package import;
 * the carrier's zod validates the truth at the bridge).
 */
export interface ImageAttachmentLimits {
  maxImageBytes: number;
  maxImagesPerMessage: number;
  maxMessageImageBytes: number;
  maxImagePixels: number;
  maxImageDimension: number;
  mediaTypes: readonly string[];
}

/** One intake candidate measured from the browser (bytes + intrinsic pixels). */
export interface ImageCandidate {
  name: string;
  mediaType: string;
  bytes: number;
  width: number;
  height: number;
}

/** A concrete, displayable refusal, or null when the set would be admitted. */
export function refuseImageIntake(
  limits: ImageAttachmentLimits | undefined,
  current: readonly ImageCandidate[],
  incoming: ImageCandidate,
): string | null {
  if (limits === undefined) return null; // no attachment service: the host answers
  if (!limits.mediaTypes.includes(incoming.mediaType)) {
    return `unsupported image type ${incoming.mediaType} (this host accepts ${limits.mediaTypes.join(", ")})`;
  }
  if (incoming.bytes > limits.maxImageBytes) {
    return `image is ${fmtBytes(incoming.bytes)} - the limit is ${fmtBytes(limits.maxImageBytes)} per image`;
  }
  const pixels = incoming.width * incoming.height;
  if (pixels > limits.maxImagePixels) {
    return `image is ${incoming.width}x${incoming.height} - the limit is ${fmtNum(limits.maxImagePixels)} pixels`;
  }
  if (incoming.width > limits.maxImageDimension || incoming.height > limits.maxImageDimension) {
    return `image side exceeds the ${fmtNum(limits.maxImageDimension)}px maximum`;
  }
  if (current.length + 1 > limits.maxImagesPerMessage) {
    return `at most ${limits.maxImagesPerMessage} images per message`;
  }
  const total = current.reduce((sum, c) => sum + c.bytes, 0) + incoming.bytes;
  if (total > limits.maxMessageImageBytes) {
    return `images total ${fmtBytes(total)} - the limit is ${fmtBytes(limits.maxMessageImageBytes)} per message`;
  }
  return null;
}

/** Base64 expansion is at most ceil(n/3)*4; 1.37 (rounded-up bytes) is the headroom. */
const BASE64_HEADROOM = 1.37;
const KIB = 1024;

/**
 * The server-action body cap (a Next SizeLimit string like "28mb") that admits
 * the host's fullest legal image message plus base64 and JSON envelope
 * headroom. When limits are absent there is no attachment path to size, so a
 * conservative floor (the old default widened for text) is returned - the
 * host refuses over-limit images regardless.
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

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

function fmtNum(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n.toLocaleString("en-US");
}
