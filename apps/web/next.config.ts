import type { NextConfig } from "next";
import { deriveBodySizeLimit, type ImageAttachmentLimits } from "./lib/image-intake";

// Dev-only: Next dev blocks its client resources (chunks, HMR) from origins
// outside this allowlist. The LAN preview host and the docker-network
// container name are provisioned via env so the shipped config stays
// machine-agnostic; `next start` (production) ignores allowedDevOrigins.
const devOrigins = process.env["DSH_NEXT_APP_DEV_ORIGINS"]?.split(",") ?? [];

// The server-action body cap must admit the host's fullest legal image
// message with base64 headroom (AC 19): derived, never hand-guessed. The
// limits below are the attachment service's shipped defaults; a deployment
// that retunes them overrides the derived cap through
// DSH_NEXT_APP_BODY_SIZE_LIMIT (same override seam as the dev origins). The
// runtime client-side pre-check (lib/image-intake.ts) is the UX; this cap
// is the backstop, and the host still answers admission at the bridge.
const HOST_DEFAULT_IMAGE_LIMITS: ImageAttachmentLimits = {
  maxImageBytes: 20 * 1024 * 1024,
  maxImagesPerMessage: 20,
  maxMessageImageBytes: 200 * 1024 * 1024,
  maxImagePixels: 64_000_000,
  maxImageDimension: 8192,
  mediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
};

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  experimental: {
    serverActions: {
      bodySizeLimit: (process.env["DSH_NEXT_APP_BODY_SIZE_LIMIT"] ??
        deriveBodySizeLimit(HOST_DEFAULT_IMAGE_LIMITS)) as `${number}kb` | `${number}mb` | number,
    },
  },
};

export default nextConfig;
