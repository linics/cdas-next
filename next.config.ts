import type { NextConfig } from "next";
import { buildDeploymentId } from "./scripts/staging/deployment-id";
import { createSourceFingerprint } from "./scripts/staging/source-fingerprint";

let sourceFingerprint = "";
try { sourceFingerprint = createSourceFingerprint(); } catch { sourceFingerprint = ""; }

const nextConfig: NextConfig = {
  // Self-host on a small VPS: ship only the traced server + static assets.
  output: "standalone",
  // Next replaces values declared here at build time; runtime env cannot alter
  // the deployment identity that health proof reports.
  env: {
    CDAS_DEPLOYMENT_ID: buildDeploymentId(process.env),
    CDAS_SOURCE_FINGERPRINT: sourceFingerprint,
  },
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
};

export default nextConfig;
