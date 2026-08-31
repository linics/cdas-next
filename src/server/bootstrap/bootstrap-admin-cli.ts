import { parseArgs } from "node:util";
import { z } from "zod";
import { BootstrapClerkCliConfigurationError, type BootstrapDatabaseTarget } from "./bootstrap-clerk-cli";
import { BootstrapAdminError, type BootstrapAdminResult } from "./bootstrap-admin";

const runOptionsSchema = z.object({ confirmDatabase: z.string().trim().min(1).max(200) }).strict();
export type ParsedBootstrapAdminCli = Readonly<{ kind: "help" }> | Readonly<{ kind: "run"; confirmedDatabase: string }>;
export class BootstrapAdminCliError extends Error { constructor(public readonly code: "INTERACTIVE_TERMINAL_REQUIRED" | "PASSWORD_CONFIRMATION_FAILED") { super(code); this.name = "BootstrapAdminCliError"; } }
export const bootstrapAdminCliHelp = `Usage:
  pnpm admin:bootstrap --confirm-database <database-name>

The command interactively asks for the one shared administrator username and
password. Password input is hidden and is never accepted as a command-line
argument, printed, logged or stored in plaintext. --confirm-database must
match DATABASE_URL exactly.
`;

export function parseBootstrapAdminCliArguments(args: readonly string[]): ParsedBootstrapAdminCli {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const { values } = parseArgs({ args: [...normalizedArgs], allowPositionals: false, strict: true, options: { help: { type: "boolean", default: false }, "confirm-database": { type: "string" } } });
  if (values.help) return { kind: "help" };
  const options = runOptionsSchema.parse({ confirmDatabase: values["confirm-database"] });
  return { kind: "run", confirmedDatabase: options.confirmDatabase };
}

export function serializeBootstrapAdminCliError(error: unknown): string {
  if (error instanceof z.ZodError) return JSON.stringify({ ok: false, error: { code: "INVALID_INPUT" } });
  if (error instanceof BootstrapClerkCliConfigurationError) return JSON.stringify({ ok: false, error: { code: error.code } });
  if (error instanceof BootstrapAdminError || error instanceof BootstrapAdminCliError) return JSON.stringify({ ok: false, error: { code: error.code } });
  if (error instanceof TypeError) return JSON.stringify({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
  return JSON.stringify({ ok: false, error: { code: "BOOTSTRAP_FAILED" } });
}

export function serializeBootstrapAdminCliSuccess(target: Pick<BootstrapDatabaseTarget, "databaseName" | "redactedTarget">, admin: BootstrapAdminResult): string {
  return JSON.stringify({ ok: true, databaseTarget: target.redactedTarget, admin }, null, 2);
}
