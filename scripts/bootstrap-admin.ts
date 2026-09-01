import nextEnvironment from "@next/env";
import { createDatabaseClient } from "../src/server/db/client";
import { bootstrapPlatformAdmin } from "../src/server/bootstrap/bootstrap-admin";
import { hashPassword } from "../src/server/auth/local-auth-primitives";

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("BOOTSTRAP_TTY_REQUIRED");
  }
  process.stdout.write(prompt);
  const input = process.stdin;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    const cleanup = () => {
      try {
        input.setRawMode?.(false);
      } finally {
        input.pause();
        input.off("data", onData);
        input.off("error", onError);
        process.off("SIGINT", onInterrupt);
      }
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString()) {
        if (character === "\u0003") {
          finish(new Error("BOOTSTRAP_CANCELLED"));
          break;
        }
        if (character === "\r" || character === "\n") {
          process.stdout.write("\n");
          finish();
          break;
        }
        if (character === "\u007f") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    const onError = () => finish(new Error("BOOTSTRAP_TTY_ERROR"));
    const onInterrupt = () => finish(new Error("BOOTSTRAP_CANCELLED"));
    input.on("data", onData);
    input.once("error", onError);
    process.once("SIGINT", onInterrupt);
  });
}
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
  const password = await readHidden("管理员密码（输入不回显）：");
  const confirmation = await readHidden("再次输入管理员密码（输入不回显）：");
  if (password !== confirmation) throw new Error("BOOTSTRAP_PASSWORD_MISMATCH");
  const passwordHash = await hashPassword(password);
  const database = createDatabaseClient(target.connectionString);
  try {
    const result = await bootstrapPlatformAdmin(database, { ...parsed.input, passwordHash });
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
