import { createDeploymentConfigurationProof } from "../../../server/staging/deployment-proof";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Response {
  const configurationProof = createDeploymentConfigurationProof({
    deploymentId: process.env.CDAS_DEPLOYMENT_ID,
    databaseUrl: process.env.DATABASE_URL,
    sourceFingerprint: process.env.CDAS_SOURCE_FINGERPRINT,
    aiProviderDisabled: process.env.AI_PROVIDER_DISABLED,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    aiModel: process.env.AI_MODEL,
    attachmentVisionModel: process.env.AI_ATTACHMENT_VISION_MODEL,
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
