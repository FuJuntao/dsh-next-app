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
 * The host's image-intake limits and the body-limit derivation live in
 * lib/body-limit.ts (the config's module - see its header); re-exported
 * here so app consumers import image facts from one seam.
 */
import { deriveBodySizeLimit, type ImageAttachmentLimits } from "./body-limit";

export { deriveBodySizeLimit, type ImageAttachmentLimits };

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

/** The per-message budget a caller holds: committed images plus pending reservations. */
export interface ImageBudget {
  /** Slots already taken (staged and/or reserved before any await). */
  usedCount: number;
  /** Bytes already taken (staged and/or reserved before any await). */
  usedBytes: number;
}

/**
 * The count/total half of the pre-check as a pure step over a running
 * budget (spec #19): the caller folds its pending batch into the budget
 * SYNCHRONOUSLY at intake time, so two quick paste/drop batches can never
 * both evaluate against the same stale committed set. Per-candidate rules
 * stay in refuseImageIntake; this owns only "does it fit yet".
 * Returns null when the image fits (the caller then adds it to the budget),
 * or the refusal copy - identical to refuseImageIntake's - when it does not.
 * Absent limits means no pre-check (AC 18): always admit.
 */
export function reserveImageBudget(
  limits: ImageAttachmentLimits | undefined,
  budget: ImageBudget,
  incomingBytes: number,
): string | null {
  if (limits === undefined) return null; // no attachment service: the host answers
  if (budget.usedCount + 1 > limits.maxImagesPerMessage) {
    return `at most ${limits.maxImagesPerMessage} images per message`;
  }
  const total = budget.usedBytes + incomingBytes;
  if (total > limits.maxMessageImageBytes) {
    return `images total ${fmtBytes(total)} - the limit is ${fmtBytes(limits.maxMessageImageBytes)} per message`;
  }
  return null;
}

function fmtNum(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n.toLocaleString("en-US");
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}
