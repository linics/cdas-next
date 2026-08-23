import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { isSafeStagingRunMarker } from "./contracts";

const outputRoot = path.resolve(process.cwd(), "output", "staging");
const invalidRunMarker = "invalid-run-marker";
const allowedArtifactNames = new Set([
  "preflight.json",
  "database.json",
  "application.json",
  "decision.json",
]);

export function resolveStagingRunDirectory(marker: string): string {
  if (!isSafeStagingRunMarker(marker)) {
    throw new Error("STAGING_RUN_MARKER_INVALID");
  }
  const directory = path.resolve(outputRoot, marker);
  if (!directory.startsWith(`${outputRoot}${path.sep}`)) {
    throw new Error("STAGING_OUTPUT_PATH_INVALID");
  }
  return directory;
}

export function safeStagingRunDirectory(marker: string): string {
  try {
    return resolveStagingRunDirectory(marker);
  } catch {
    return path.resolve(outputRoot, invalidRunMarker);
  }
}

export async function writeStagingArtifact(
  marker: string,
  artifactName: string,
  value: unknown,
): Promise<void> {
  if (!allowedArtifactNames.has(artifactName)) {
    throw new Error("STAGING_ARTIFACT_NAME_INVALID");
  }
  const directory = safeStagingRunDirectory(marker);
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, artifactName),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}
