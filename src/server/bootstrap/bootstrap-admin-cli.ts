import { parseArgs } from "node:util";
import { z } from "zod";
import { adminIdentifier } from "../auth/local-auth-primitives";
import {
  resolveBootstrapDatabaseTarget,
  type BootstrapDatabaseTarget,
} from "./bootstrap-database-cli";
import {
  BootstrapAdminError,
  type BootstrapAdminResult,
} from "./bootstrap-admin";

const cliInputSchema = z.object({
  adminIdentifier: z.string().trim().regex(/^admin:[a-z0-9][a-z0-9._-]{0,63}$/u),
  adminDisplayName: z.string().trim().min(1).max(120),
}).strict();

const runOptionsSchema = z
  .object({
    adminUsername: z.string().trim().min(1).max(64),
    adminName: z.string(),
    confirmDatabase: z.string().trim().min(1).max(200),
  })
  .strict();

export type ParsedBootstrapAdminCli =
  | Readonly<{ kind: "help" }>
  | Readonly<{
      kind: "run";
      input: z.infer<typeof cliInputSchema>;
      confirmedDatabase: string;
    }>;

export const bootstrapAdminCliHelp = `Usage:
  pnpm bootstrap:admin \\
    --admin-username operator \\
    --admin-name "Operator name" \\
    --confirm-database <database-name>

The command prompts for a hidden password and never accepts it as a CLI argument.
The platform has exactly one ADMIN.
`;

export function parseBootstrapAdminCliArguments(
  args: readonly string[],
): ParsedBootstrapAdminCli {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const { values } = parseArgs({
    args: [...normalizedArgs],
    allowPositionals: false,
    strict: true,
    options: {
      help: { type: "boolean", default: false },
      "admin-username": { type: "string" },
      "admin-name": { type: "string" },
      "confirm-database": { type: "string" },
    },
  });
  if (values.help) {
    return { kind: "help" };
  }
  const options = runOptionsSchema.parse({
    adminUsername: values["admin-username"],
    adminName: values["admin-name"],
    confirmDatabase: values["confirm-database"],
  });
  return {
    kind: "run",
    input: cliInputSchema.parse({
      adminIdentifier: adminIdentifier(options.adminUsername),
      adminDisplayName: options.adminName,
    }),
    confirmedDatabase: options.confirmDatabase,
  };
}

export function serializeBootstrapAdminCliSuccess(
  target: BootstrapDatabaseTarget,
  result: BootstrapAdminResult,
): string {
  return JSON.stringify({
    database: target.redactedTarget,
    admin: result.admin,
  });
}

export function serializeBootstrapAdminCliError(error: unknown): string {
  if (error instanceof BootstrapAdminError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "BOOTSTRAP_ADMIN_FAILED";
}

export { resolveBootstrapDatabaseTarget };
