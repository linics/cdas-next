import { createDeploymentConfigurationProof } from "../../../server/staging/deployment-proof";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  const configurationProof = createDeploymentConfigurationProof({
    deploymentId: process.env.CDAS_DEPLOYMENT_ID,
    databaseUrl: process.env.DATABASE_URL,
    sourceFingerprint: process.env.CDAS_SOURCE_FINGERPRINT,
    clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    clerkSecretKey: process.env.CLERK_SECRET_KEY,
    aiProviderDisabled: process.env.AI_PROVIDER_DISABLED,
    aiGatewayApiKey: process.env.AI_GATEWAY_API_KEY,
    aiModel: process.env.AI_MODEL,
    aiToolApprovalSecret: process.env.AI_TOOL_APPROVAL_SECRET,
    secret: process.env.STAGING_HEALTH_PROOF_SECRET,
    challenge: request.headers.get("x-cdas-health-challenge") ?? undefined,
  });
  if (!configurationProof) {
    return Response.json(
      { status: "unconfigured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    {
      status: "ok",
      deploymentId: process.env.CDAS_DEPLOYMENT_ID?.trim().toLowerCase(),
      sourceFingerprint: process.env.CDAS_SOURCE_FINGERPRINT,
      configurationProof,
    },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
