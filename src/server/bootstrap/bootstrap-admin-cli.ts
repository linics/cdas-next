import { parseArgs } from "node:util";
import { z } from "zod";
import {
  resolveBootstrapDatabaseTarget,
  type BootstrapDatabaseTarget,
} from "./bootstrap-clerk-cli";
import {
  BootstrapAdminError,
  bootstrapAdminInputSchema,
  type BootstrapAdminInput,
  type BootstrapAdminResult,
} from "./bootstrap-admin";

const runOptionsSchema = z
  .object({
    adminSubject: z.string(),
    adminName: z.string(),
    confirmDatabase: z.string().trim().min(1).max(200),
  })
  .strict();

export type ParsedBootstrapAdminCli =
  | Readonly<{ kind: "help" }>
  | Readonly<{
      kind: "run";
      input: BootstrapAdminInput;
      confirmedDatabase: string;
    }>;

export const bootstrapAdminCliHelp = `Usage:
  pnpm bootstrap:admin \\
    --admin-subject user_... \\
    --admin-name "Operator name" \\
    --confirm-database <database-name>

The Clerk user must already exist. This command never calls Clerk, never
stores a password, and will not overwrite a teacher or student account.
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
      "admin-subject": { type: "string" },
      "admin-name": { type: "string" },
      "confirm-database": { type: "string" },
    },
  });
  if (values.help) {
    return { kind: "help" };
  }
  const options = runOptionsSchema.parse({
    adminSubject: values["admin-subject"],
    adminName: values["admin-name"],
    confirmDatabase: values["confirm-database"],
  });
  return {
    kind: "run",
    input: bootstrapAdminInputSchema.parse({
      adminAuthSubject: options.adminSubject,
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
