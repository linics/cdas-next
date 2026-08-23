import { createClerkClient } from "@clerk/nextjs/server";

import { stableAcceptanceErrorCode } from "./contracts";
import { verifyAcceptanceIdentities } from "./identity";
import { writeAcceptanceArtifact } from "./output";
import { assertIdentityPrerequisites } from "./prerequisites";

async function main(): Promise<void> {
  await assertIdentityPrerequisites(process.env);
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    telemetry: { disabled: true },
  });
  const checks = await verifyAcceptanceIdentities(process.env, clerk);
  const evidence = {
    schema: "staging-synthetic-acceptance-identity.v1",
    status: "PASS",
    checks,
    ticketsRevoked: true,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  } as const;
  await writeAcceptanceArtifact(marker, "identity.json", evidence);
  process.stdout.write(`${JSON.stringify({ schema: evidence.schema, status: evidence.status })}\n`);
}

void main().catch(async (error: unknown) => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try {
    await writeAcceptanceArtifact(marker, "identity.json", {
      schema: "staging-synthetic-acceptance-identity.v1",
      status: "FAIL",
      checks: [{ code: stableAcceptanceErrorCode(error), status: "FAIL" }],
      ticketsRevoked: false,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
  } catch { /* invalid markers do not get a fallback output path */ }
  process.stdout.write('{"schema":"staging-synthetic-acceptance-identity.v1","status":"FAIL"}\n');
  process.exitCode = 1;
});
