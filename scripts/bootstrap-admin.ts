import nextEnvironment from "@next/env";
import { createDatabaseClient } from "../src/server/db/client";
import { bootstrapPlatformAdmin } from "../src/server/bootstrap/bootstrap-admin";
import {
  bootstrapAdminCliHelp,
  parseBootstrapAdminCliArguments,
  resolveBootstrapDatabaseTarget,
  serializeBootstrapAdminCliError,
  serializeBootstrapAdminCliSuccess,
} from "../src/server/bootstrap/bootstrap-admin-cli";

nextEnvironment.loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const parsed = parseBootstrapAdminCliArguments(process.argv.slice(2));
  if (parsed.kind === "help") {
    process.stdout.write(bootstrapAdminCliHelp);
    return;
  }

  const target = resolveBootstrapDatabaseTarget(
    {
      databaseUrl: process.env.DATABASE_URL,
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
    },
    parsed.confirmedDatabase,
  );
  const database = createDatabaseClient(target.connectionString);
  try {
    const result = await bootstrapPlatformAdmin(database, parsed.input);
    process.stdout.write(
      `${serializeBootstrapAdminCliSuccess(target, result)}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${serializeBootstrapAdminCliError(error)}\n`);
  process.exitCode = 1;
});
