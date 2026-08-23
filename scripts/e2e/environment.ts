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

export function requireNonProductionClerkForE2e(): void {
  loadE2eEnvironment();
  if (
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_") ||
    process.env.CLERK_SECRET_KEY?.startsWith("sk_live_")
  ) {
    throw new Error("E2E_CLERK_PRODUCTION_INSTANCE_FORBIDDEN");
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
