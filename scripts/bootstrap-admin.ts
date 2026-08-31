import { createInterface } from "node:readline/promises";
import nextEnvironment from "@next/env";
import { createDatabaseClient } from "../src/server/db/client";
import { hashLocalPassword } from "../src/server/auth/local-auth";
import { bootstrapAdminCliHelp, BootstrapAdminCliError, parseBootstrapAdminCliArguments, serializeBootstrapAdminCliError, serializeBootstrapAdminCliSuccess } from "../src/server/bootstrap/bootstrap-admin-cli";
import { bootstrapAdmin } from "../src/server/bootstrap/bootstrap-admin";
import { resolveBootstrapDatabaseTarget } from "../src/server/bootstrap/bootstrap-clerk-cli";

nextEnvironment.loadEnvConfig(process.cwd());

async function readVisible(prompt: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await reader.question(prompt)).trim(); } finally { reader.close(); }
}

async function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new BootstrapAdminCliError("INTERACTIVE_TERMINAL_REQUIRED");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk: Buffer) => {
      const input = chunk.toString("utf8");
      for (const character of input) {
        if (character === "\u0003") { finish(new BootstrapAdminCliError("INTERACTIVE_TERMINAL_REQUIRED")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\b" || character === "\u007f") { value = value.slice(0, -1); continue; }
        if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const parsed = parseBootstrapAdminCliArguments(process.argv.slice(2));
  if (parsed.kind === "help") { process.stdout.write(bootstrapAdminCliHelp); return; }
  const target = resolveBootstrapDatabaseTarget({ databaseUrl: process.env.DATABASE_URL, testDatabaseUrl: process.env.TEST_DATABASE_URL }, parsed.confirmedDatabase);
  const username = await readVisible("共享管理员用户名: ");
  const password = await readHidden("共享管理员密码（不回显）: ");
  const confirmation = await readHidden("再次输入密码: ");
  if (!password || password !== confirmation) throw new BootstrapAdminCliError("PASSWORD_CONFIRMATION_FAILED");
  const database = createDatabaseClient(target.connectionString);
  try {
    const result = await bootstrapAdmin(database, { username, passwordHash: await hashLocalPassword(password) });
    process.stdout.write(`${serializeBootstrapAdminCliSuccess(target, result)}\n`);
  } finally { await database.$disconnect(); }
}

main().catch((error: unknown) => { process.stderr.write(`${serializeBootstrapAdminCliError(error)}\n`); process.exitCode = 1; });
