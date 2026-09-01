import nextEnvironment from "@next/env";
import { requireIsolatedE2eDatabaseUrl } from "../../src/test/database-url-safety";

export const defaultE2eDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:5434/cdas_next_e2e";
export const e2eDatabaseName = "cdas_next_e2e";

let environmentLoaded = false;

export function loadE2eEnvironment(): void {
  if (environmentLoaded) {
    return;
  }
  nextEnvironment.loadEnvConfig(process.cwd());
  environmentLoaded = true;
}

export function resolveE2eDatabaseUrl(): string {
  loadE2eEnvironment();
  return requireIsolatedE2eDatabaseUrl({
    e2eDatabaseUrl: process.env.E2E_DATABASE_URL || defaultE2eDatabaseUrl,
    runtimeDatabaseUrl: process.env.DATABASE_URL,
    directDatabaseUrl: process.env.DIRECT_URL,
    testDatabaseUrl: process.env.TEST_DATABASE_URL,
  });
}

export function requireSafeE2eTarget(): void {
  loadE2eEnvironment();
  resolveE2eDatabaseUrl();
  const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  const parsed = new URL(baseUrl);
  if (
    parsed.protocol !== "http:" ||
    !parsed.hostname ||
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
    parsed.port !== "3100" ||
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("E2E_BASE_URL_MUST_BE_LOOPBACK");
  }
}

export function requireE2eRunMarker(): string {
  loadE2eEnvironment();
  const marker = process.env.E2E_RUN_MARKER?.trim();
  if (!marker || !/^cdas-e2e-[a-z0-9-]{8,80}$/u.test(marker)) {
    throw new Error("E2E_RUN_MARKER_INVALID");
  }
  return marker;
}
