import type { NextConfig } from "next";

// Dev-only: Next dev blocks its client resources (chunks, HMR) from origins
// outside this allowlist. The LAN preview host and the docker-network
// container name are provisioned via env so the shipped config stays
// machine-agnostic; `next start` (production) ignores allowedDevOrigins.
const devOrigins = process.env["DSH_NEXT_APP_DEV_ORIGINS"]?.split(",") ?? [];

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
};

export default nextConfig;
