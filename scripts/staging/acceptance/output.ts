import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { isSafeStagingRunMarker } from "../contracts";

const root = path.resolve(process.cwd(), "output", "staging-acceptance");
const allowedNames = new Set(["readiness.json", "gate.json", "immediate-health.json", "identity.json", "bootstrap.json", "verify.json", "evidence.json", "final.json"]);

export function acceptanceOutputDirectory(marker: string): string {
  if (!isSafeStagingRunMarker(marker)) throw new Error("STAGING_ACCEPTANCE_MARKER_INVALID");
  const directory = path.resolve(root, marker);
  if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("STAGING_ACCEPTANCE_OUTPUT_PATH_INVALID");
  return directory;
}

export async function writeAcceptanceArtifact(marker: string, name: string, value: unknown): Promise<void> {
  if (!allowedNames.has(name)) throw new Error("STAGING_ACCEPTANCE_ARTIFACT_INVALID");
  const directory = acceptanceOutputDirectory(marker);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
