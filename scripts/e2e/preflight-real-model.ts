import {
  loadE2eEnvironment,
  requireNonProductionClerkForE2e,
  resolveE2eDatabaseUrl,
} from "./environment";

const acknowledgement = "synthetic-data-cost-approved";
const modelPattern =
  /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function requireValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name}_REQUIRED`);
  }
  return value;
}

function main(): void {
  loadE2eEnvironment();
  requireNonProductionClerkForE2e();
  resolveE2eDatabaseUrl();

  if (process.env.E2E_REAL_MODEL_ACK !== acknowledgement) {
    throw new Error("E2E_REAL_MODEL_COST_ACK_REQUIRED");
  }
  if (process.env.AI_PROVIDER_DISABLED?.trim() !== "0") {
    throw new Error("E2E_REAL_MODEL_MUST_BE_EXPLICITLY_ENABLED");
  }

  const gatewayKey = requireValue("AI_GATEWAY_API_KEY");
  const model = requireValue("AI_MODEL");
  const approvalSecret = process.env.AI_TOOL_APPROVAL_SECRET ?? "";
  requireValue("DEV_TEST_TEACHER_CLERK_ID");
  requireValue("DEV_TEST_STUDENT_CLERK_ID");

  if (gatewayKey.length > 2_000) {
    throw new Error("AI_GATEWAY_API_KEY_INVALID");
  }
  if (model.length > 200 || !modelPattern.test(model)) {
    throw new Error("AI_MODEL_INVALID");
  }
  if (approvalSecret.length < 32 || approvalSecret.length > 4_096) {
    throw new Error("AI_TOOL_APPROVAL_SECRET_INVALID");
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      provider: "ai-sdk-gateway",
      model,
      dataClassification: "synthetic-only",
      releaseWritesAllowed: false,
    })}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: {
        code: error instanceof Error ? error.message : "E2E_PREFLIGHT_FAILED",
      },
    })}\n`,
  );
  process.exitCode = 1;
}
