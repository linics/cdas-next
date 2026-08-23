import nextEnvironment from "@next/env";
import { createDatabaseClient } from "../src/server/db/client";
import { bootstrapClerkClassroom } from "../src/server/bootstrap/bootstrap-clerk-classroom";
import {
  bootstrapClerkCliHelp,
  parseBootstrapClerkCliArguments,
  resolveBootstrapDatabaseTarget,
  serializeBootstrapClerkCliError,
  serializeBootstrapClerkCliSuccess,
} from "../src/server/bootstrap/bootstrap-clerk-cli";

// This operator command runs outside the Next.js runtime. Reuse Next's
// official loader so the documented root `.env*` files and load order are the
// same for `pnpm dev`, Prisma, and bootstrap operations.
nextEnvironment.loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const parsed = parseBootstrapClerkCliArguments(process.argv.slice(2));
  if (parsed.kind === "help") {
    process.stdout.write(bootstrapClerkCliHelp);
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
    const result = await bootstrapClerkClassroom(database, parsed.input);
    process.stdout.write(
      `${serializeBootstrapClerkCliSuccess(target, result)}\n`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${serializeBootstrapClerkCliError(error)}\n`);
  process.exitCode = 1;
});
