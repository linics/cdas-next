import nextEnvironment from "@next/env";
import { Client } from "pg";
import { createHash } from "node:crypto";

import { hasSafeDatabaseVerifierConfiguration } from "./contracts";
import {
  combinesDatabaseResults,
  evaluateDatabaseInspection,
  failedDatabaseVerification,
  requiredHistoryProtectionConstraints,
  requiredHistoryProtectionFunctions,
  requiredHistoryProtectionTriggers,
  repositoryMigrationNames,
} from "./database";
import { writeStagingArtifact } from "./output";

type MigrationRow = Readonly<{
  migration_name: string;
  finished: boolean;
  rolled_back: boolean;
  has_logs: boolean;
}>;

async function inspectDatabase(
  connectionString: string,
  expectedDatabaseName: string,
  expectedMigrationNames: readonly string[],
) {
  const client = new Client({ connectionString });
  let transactionStarted = false;
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    transactionStarted = true;
    const identity = await client.query<{
      database_name: string;
      server_version_number: string;
    }>(
      "SELECT current_database() AS database_name, current_setting('server_version_num') AS server_version_number",
    );
    const system = await client.query<{ system_identifier: string }>(
      "SELECT pg_control_system().system_identifier::text AS system_identifier",
    );
    const table = await client.query<{ migrations_table_present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class relation JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace WHERE relation.relname = '_prisma_migrations' AND namespace.nspname = 'public') AS migrations_table_present",
    );
    const migrations = table.rows[0]?.migrations_table_present
      ? await client.query<MigrationRow>(
          "SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, logs IS NOT NULL AS has_logs FROM public._prisma_migrations ORDER BY started_at ASC",
        )
      : { rows: [] as MigrationRow[] };
    const historyObjects = await client.query<{
      object_name: string;
      definition: string;
    }>(
      "SELECT 'function:public.' || routine.proname || '(' || pg_get_function_identity_arguments(routine.oid) || ')' AS object_name, pg_get_functiondef(routine.oid) AS definition FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace WHERE namespace.nspname = 'public' AND routine.proname = ANY($1::text[]) UNION ALL SELECT 'trigger:public.' || relation.relname || '.' || trigger.tgname AS object_name, pg_get_triggerdef(trigger.oid, false) AS definition FROM pg_catalog.pg_trigger trigger JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal AND trigger.tgname = ANY($2::text[]) UNION ALL SELECT 'constraint:public.' || relation.relname || '.' || constraint_record.conname AS object_name, pg_get_constraintdef(constraint_record.oid, false) AS definition FROM pg_catalog.pg_constraint constraint_record JOIN pg_catalog.pg_class relation ON relation.oid = constraint_record.conrelid JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' AND constraint_record.conname = ANY($3::text[])",
      [
        requiredHistoryProtectionFunctions,
        requiredHistoryProtectionTriggers,
        requiredHistoryProtectionConstraints,
      ],
    );
    await client.query("ROLLBACK");
    transactionStarted = false;
    return {
      systemIdentifier: system.rows[0]?.system_identifier,
      verification: evaluateDatabaseInspection(
      {
        databaseName: identity.rows[0]?.database_name ?? "",
        serverVersionNumber: Number(identity.rows[0]?.server_version_number ?? 0),
        migrationsTablePresent: table.rows[0]?.migrations_table_present ?? false,
        migrations: migrations.rows.map((migration) => ({
          migrationName: migration.migration_name,
          finished: migration.finished,
          rolledBack: migration.rolled_back,
          hasLogs: migration.has_logs,
        })),
        historyProtectionObjectNames: historyObjects.rows.map(
          (historyObject) => historyObject.object_name,
        ),
        historyProtectionDefinitionHashes: Object.fromEntries(
          historyObjects.rows.map((historyObject) => [
            historyObject.object_name,
            createHash("sha256")
              .update(`${historyObject.object_name}\0${historyObject.definition}`, "utf8")
              .digest("hex"),
          ]),
        ),
      },
      expectedDatabaseName,
        expectedMigrationNames,
      ),
    };
  } catch {
    if (transactionStarted) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    return {
      systemIdentifier: undefined,
      verification: failedDatabaseVerification("DATABASE_READ_ONLY_CONNECTION_FAILED"),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(process.cwd());
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  if (!hasSafeDatabaseVerifierConfiguration(process.env)) {
    const result = failedDatabaseVerification("DATABASE_PREFLIGHT_REQUIRED");
    await writeStagingArtifact(marker, "database.json", result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
    return;
  }
  const expectedMigrations = await repositoryMigrationNames();
  const expectedDatabaseName = process.env.STAGING_DATABASE_NAME?.trim() ?? "";
  const results = await Promise.all([
    inspectDatabase(
      process.env.DATABASE_URL?.trim() ?? "",
      expectedDatabaseName,
      expectedMigrations,
    ),
    inspectDatabase(
      process.env.DIRECT_URL?.trim() ?? "",
      expectedDatabaseName,
      expectedMigrations,
    ),
  ]);
  const combined = combinesDatabaseResults(results.map((result) => result.verification));
  const systemIdentifiersMatch = Boolean(
    results[0]?.systemIdentifier &&
      results[0].systemIdentifier === results[1]?.systemIdentifier,
  );
  const checks = [
    ...combined.checks,
    {
      code: "DATABASE_CLUSTER_SYSTEM_IDENTIFIERS_MATCH",
      status: systemIdentifiersMatch ? "PASS" as const : "FAIL" as const,
    },
  ];
  const result = {
    ...combined,
    checks,
    status: checks.every((check) => check.status === "PASS") ? "PASS" as const : "FAIL" as const,
    stagingSyntheticDecision: checks.every((check) => check.status === "PASS") ? "GO" as const : "NO_GO" as const,
  };
  await writeStagingArtifact(marker, "database.json", result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "PASS") {
    process.exitCode = 1;
  }
}

void main().catch(async () => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  const result = failedDatabaseVerification("DATABASE_VERIFIER_INTERNAL_ERROR");
  await writeStagingArtifact(marker, "database.json", result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = 1;
});
