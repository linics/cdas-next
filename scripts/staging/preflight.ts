import nextEnvironment from "@next/env";

import { evaluateStagingPreflight } from "./contracts";
import { writeStagingArtifact } from "./output";

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(process.cwd());
  const result = evaluateStagingPreflight(process.env);
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  await writeStagingArtifact(marker, "preflight.json", result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "PASS") {
    process.exitCode = 1;
  }
}

void main().catch(async () => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const result = {
    schema: "staging-preflight.v1",
    status: "FAIL",
    checks: [{ code: "STAGING_PREFLIGHT_INTERNAL_ERROR", status: "FAIL" }],
    stagingSyntheticDecision: "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  } as const;
  await writeStagingArtifact(marker, "preflight.json", result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
