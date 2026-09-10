import type { NextConfig } from "next";
import { deriveBodySizeLimit, HOST_DEFAULT_IMAGE_LIMITS } from "./lib/body-limit";

// Dev-only: Next dev blocks its client resources (chunks, HMR) from origins
// outside this allowlist. The LAN preview host and the docker-network
// container name are provisioned via env so the shipped config stays
// machine-agnostic; `next start` (production) ignores allowedDevOrigins.
const devOrigins = process.env["DSH_NEXT_APP_DEV_ORIGINS"]?.split(",") ?? [];

// The server-action body cap must admit the host's fullest legal image
// message with base64 headroom (AC 19): derived from the shipped
// attachment defaults in lib/body-limit.ts (DSH_NEXT_APP_BODY_SIZE_LIMIT
// overrides for retuned deployments). The runtime client-side pre-check is
// the UX; this cap is the backstop behind it.
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
