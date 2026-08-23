import { readFile } from "node:fs/promises";
import path from "node:path";

import nextEnvironment from "@next/env";

import {
  evaluateStagingDecision,
  requiredManualAttestations,
  type StagingDecision,
} from "./decision";
import { safeStagingRunDirectory, writeStagingArtifact } from "./output";

async function readEvidence(marker: string, artifactName: string): Promise<unknown> {
  try {
    const file = path.join(safeStagingRunDirectory(marker), artifactName);
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(process.cwd());
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const [preflight, database, application] = await Promise.all([
    readEvidence(marker, "preflight.json"),
    readEvidence(marker, "database.json"),
    readEvidence(marker, "application.json"),
  ]);
  const manual = Object.fromEntries(
    requiredManualAttestations.map((name) => [name, process.env[name]]),
  );
  const decision = evaluateStagingDecision({
    preflight,
    database,
    application,
    buildOutcome: process.env.STAGING_BUILD_OUTCOME,
    schemaDiffOutcome: process.env.STAGING_SCHEMA_DIFF_OUTCOME,
    manualAttestations: manual,
  });
  await writeStagingArtifact(marker, "decision.json", decision);
  process.stdout.write(`${JSON.stringify(decision)}\n`);
}

void main().catch(async () => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const decision: StagingDecision = {
    schema: "staging-go-no-go.v1",
    decision: "NO_GO",
    stagingSyntheticDecision: "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
    checks: [{ code: "DECISION_AGGREGATOR_INTERNAL_ERROR", status: "FAIL" }],
  };
  await writeStagingArtifact(marker, "decision.json", decision);
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  process.exitCode = 1;
});
