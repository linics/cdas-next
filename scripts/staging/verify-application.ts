import nextEnvironment from "@next/env";
import { randomBytes } from "node:crypto";

import {
  evaluateHealthResponse,
  failedApplicationVerification,
  isVercelDeploymentProtectionResponse,
} from "./application";
import {
  isDeploymentProtectionRequired,
  isPublicHttpsRoot,
  isValidDeploymentProtectionMode,
} from "./contracts";
import { writeStagingArtifact } from "./output";
import { createDeploymentConfigurationProof } from "../../src/server/staging/deployment-proof";
import { createSourceFingerprint } from "./source-fingerprint";
import {
  isAllowedVercelPreviewBaseUrl,
  stagingHealthRequestHeaders,
} from "./preview-protection";
import { shouldLoadLocalStagingEnvironment } from "./verify-application-env";

async function main(): Promise<void> {
  if (shouldLoadLocalStagingEnvironment(process.env)) nextEnvironment.loadEnvConfig(process.cwd());
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
    const rawBaseUrl = process.env.STAGING_BASE_URL ?? "";
    const deploymentProtectionMode = process.env.STAGING_DEPLOYMENT_PROTECTION_REQUIRED?.trim() ?? "";
    if (!isValidDeploymentProtectionMode(deploymentProtectionMode)) {
      throw new Error("STAGING_DEPLOYMENT_PROTECTION_MODE_INVALID");
    }
    const deploymentProtectionRequired = isDeploymentProtectionRequired(
      deploymentProtectionMode,
    );
    if (deploymentProtectionRequired
      ? !isAllowedVercelPreviewBaseUrl(rawBaseUrl, process.env.STAGING_VERCEL_PROJECT_NAME ?? "")
      : !isPublicHttpsRoot(rawBaseUrl)) {
      throw new Error("STAGING_BASE_URL_INVALID");
    }
    const baseUrl = new URL(rawBaseUrl);
    const healthUrl = new URL("/api/health", baseUrl);
    if (deploymentProtectionRequired) {
      const protection = await fetch(healthUrl, {
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (!isVercelDeploymentProtectionResponse({
        status: protection.status,
        server: protection.headers.get("server"),
        vercelId: protection.headers.get("x-vercel-id"),
        location: protection.headers.get("location"),
        healthUrl: healthUrl.toString(),
      })) {
        throw new Error("APPLICATION_DEPLOYMENT_PROTECTION_NOT_ENFORCED");
      }
    }
    const response = await fetch(healthUrl, {
      headers: {
        ...stagingHealthRequestHeaders(
          deploymentProtectionRequired,
          process.env,
          challenge,
        ),
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const body: unknown = await response.json().catch(() => null);
    const result = evaluateHealthResponse({
      deploymentAccessModeVerified: true,
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
  } catch (error) {
    const code = error instanceof Error && [
      "STAGING_VERCEL_AUTOMATION_BYPASS_SECRET_INVALID",
      "STAGING_DEPLOYMENT_PROTECTION_MODE_INVALID",
      "STAGING_BASE_URL_INVALID",
      "APPLICATION_DEPLOYMENT_PROTECTION_NOT_ENFORCED",
    ].includes(error.message)
      ? error.message
      : "APPLICATION_HEALTH_REQUEST_FAILED";
    const result = failedApplicationVerification(code);
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
