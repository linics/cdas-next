import { describe, expect, it } from "vitest";

import {
  evaluateDatabaseInspection,
} from "./database";
import { historyProtectionDefinitionManifest } from "./database-manifest";

const expectedMigrations = ["20260818000000_init", "20260819000000_history"];
const healthyInspection = {
  databaseName: "cdas_next_staging",
  serverVersionNumber: 170002,
  migrationsTablePresent: true,
  migrations: expectedMigrations.map((migrationName) => ({
    migrationName,
    finished: true,
    rolledBack: false,
    hasLogs: false,
  })),
  historyProtectionObjectNames: Object.keys(historyProtectionDefinitionManifest),
  historyProtectionDefinitionHashes: historyProtectionDefinitionManifest,
} as const;

describe("evaluateDatabaseInspection", () => {
  it("requires exact applied migration metadata on PostgreSQL 17+", () => {
    const result = evaluateDatabaseInspection(
      healthyInspection,
      "cdas_next_staging",
      expectedMigrations,
    );

    expect(result.status).toBe("PASS");
    expect(result.productionDecision).toBe("NO_GO");
  });

  it.each([
    ["wrong database", { databaseName: "other" }, "DATABASE_EXPECTED_NAME"],
    ["old PostgreSQL", { serverVersionNumber: 160999 }, "POSTGRESQL_17_OR_NEWER"],
    ["missing migrations table", { migrationsTablePresent: false }, "PRISMA_MIGRATIONS_TABLE_PRESENT"],
    ["pending migration", { migrations: [healthyInspection.migrations[0]] }, "PRISMA_MIGRATIONS_NO_PENDING"],
    ["unknown migration", { migrations: [...healthyInspection.migrations, { migrationName: "unknown", finished: true, rolledBack: false, hasLogs: false }] }, "PRISMA_MIGRATIONS_NO_UNKNOWN"],
    ["failed migration", { migrations: [{ ...healthyInspection.migrations[0], hasLogs: true }, healthyInspection.migrations[1]] }, "PRISMA_MIGRATIONS_NO_FAILED_ROWS"],
    ["missing history protection object", { historyProtectionObjectNames: Object.keys(historyProtectionDefinitionManifest).slice(1) }, "HISTORY_PROTECTION_OBJECTS_PRESENT"],
    ["extra history protection object", { historyProtectionObjectNames: [...Object.keys(historyProtectionDefinitionManifest), "trigger:public.other.duplicate"] }, "HISTORY_PROTECTION_OBJECTS_PRESENT"],
    ["duplicate history protection identity", { historyProtectionObjectNames: [...Object.keys(historyProtectionDefinitionManifest), Object.keys(historyProtectionDefinitionManifest)[0]!] }, "HISTORY_PROTECTION_OBJECTS_PRESENT"],
    ["mutated history definition", { historyProtectionDefinitionHashes: { ...historyProtectionDefinitionManifest, [Object.keys(historyProtectionDefinitionManifest)[0]!]: "0".repeat(64) } }, "HISTORY_PROTECTION_DEFINITIONS_MATCH"],
    ["extra history definition", { historyProtectionDefinitionHashes: { ...historyProtectionDefinitionManifest, "trigger:public.other.duplicate": "0".repeat(64) } }, "HISTORY_PROTECTION_DEFINITIONS_MATCH"],
  ])("fails closed for %s", (_name, override, code) => {
    const result = evaluateDatabaseInspection(
      { ...healthyInspection, ...override },
      "cdas_next_staging",
      expectedMigrations,
    );

    expect(result.status).toBe("FAIL");
    expect(result.checks).toContainEqual({ code, status: "FAIL" });
  });
});
