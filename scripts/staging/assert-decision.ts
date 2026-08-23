import { readFile } from "node:fs/promises";
import path from "node:path";

import { decisionExitCode, isStagingDecision } from "./decision";
import { safeStagingRunDirectory } from "./output";

async function main(): Promise<void> {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try {
    const file = path.join(safeStagingRunDirectory(marker), "decision.json");
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isStagingDecision(value)) {
      throw new Error("INVALID_DECISION");
    }
    process.stdout.write(`${JSON.stringify({ schema: value.schema, decision: value.decision })}\n`);
    process.exitCode = decisionExitCode(value);
  } catch {
    process.stdout.write('{"schema":"staging-go-no-go.v1","decision":"NO_GO"}\n');
    process.exitCode = 1;
  }
}

void main();
