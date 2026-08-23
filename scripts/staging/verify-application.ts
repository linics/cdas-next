import nextEnvironment from "@next/env";
import { randomBytes } from "node:crypto";

import {
  evaluateHealthResponse,
  failedApplicationVerification,
} from "./application";
import { writeStagingArtifact } from "./output";
import { createDeploymentConfigurationProof } from "../../src/server/staging/deployment-proof";
import { createSourceFingerprint } from "./source-fingerprint";

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(process.cwd());
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const challenge = randomBytes(32).toString("hex");
  const sourceFingerprint = createSourceFingerprint();
  const configurationProof = createDeploymentConfigurationProof({
    deploymentId: process.env.CDAS_DEPLOYMENT_ID,
    databaseUrl: process.env.DATABASE_URL,
    sourceFingerprint,
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    aiProviderDisabled: process.env.AI_PROVIDER_DISABLED,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    aiModel: process.env.AI_MODEL,
    aiToolApprovalSecret: process.env.AI_TOOL_APPROVAL_SECRET,
    secret: process.env.STAGING_HEALTH_PROOF_SECRET,
    challenge,
  });
  const deploymentId = process.env.CDAS_DEPLOYMENT_ID?.trim().toLowerCase() ?? "";
  if (!configurationProof || !/^[a-f0-9]{40}$/u.test(deploymentId)) {
    const result = failedApplicationVerification("APPLICATION_PREFLIGHT_REQUIRED");
    await writeStagingArtifact(marker, "application.json", result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    const baseUrl = new URL(process.env.STAGING_BASE_URL ?? "");
    const healthUrl = new URL("/api/health", baseUrl);
    const response = await fetch(healthUrl, {
      headers: {
        accept: "application/json",
        "x-cdas-health-challenge": challenge,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json().catch(() => null);
    const result = evaluateHealthResponse({
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body,
      expectedDeploymentId: deploymentId,
      expectedConfigurationProof: configurationProof,
      expectedSourceFingerprint: sourceFingerprint,
    });
    await writeStagingArtifact(marker, "application.json", result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "PASS") {
      process.exitCode = 1;
    }
  } catch {
    const result = failedApplicationVerification("APPLICATION_HEALTH_REQUEST_FAILED");
    await writeStagingArtifact(marker, "application.json", result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  }
}

void main().catch(async () => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const result = failedApplicationVerification("APPLICATION_VERIFIER_INTERNAL_ERROR");
  await writeStagingArtifact(marker, "application.json", result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
