import { readFile } from "node:fs/promises";
import path from "node:path";

import { isAcceptanceGate } from "./gate";

async function main(): Promise<void> {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const file = path.join(process.cwd(), "output", "staging-acceptance", marker, "gate.json");
  try {
    const gate = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (!isAcceptanceGate(gate, process.env)) throw new Error("STAGING_ACCEPTANCE_GATE_NOT_GO");
    process.stdout.write('{"schema":"staging-synthetic-acceptance-gate.v1","decision":"GO"}\n');
  } catch {
    process.stdout.write('{"schema":"staging-synthetic-acceptance-gate.v1","decision":"NO_GO"}\n');
    process.exitCode = 1;
  }
}

void main();
