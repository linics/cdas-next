import { parseArgs } from "node:util";
import { z } from "zod";
import {
  bootstrapClerkClassroomInputSchema,
  BootstrapClerkClassroomError,
  type BootstrapClerkClassroomInput,
  type BootstrapClerkClassroomResult,
} from "./bootstrap-clerk-classroom";

const runOptionsSchema = z
  .object({
    teacherSubject: z.string(),
    teacherName: z.string(),
    studentSubject: z.string(),
    studentName: z.string(),
    studentRosterKey: z.string().optional(),
    classroomId: z.string(),
    classroomName: z.string(),
    confirmDatabase: z.string().trim().min(1).max(200),
  })
  .strict();

const databaseEnvironmentSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    testDatabaseUrl: z.string().trim().min(1).optional(),
  })
  .strict();

export type ParsedBootstrapClerkCli =
  | Readonly<{ kind: "help" }>
  | Readonly<{
      kind: "run";
      input: BootstrapClerkClassroomInput;
      confirmedDatabase: string;
    }>;

export type BootstrapDatabaseTarget = Readonly<{
  connectionString: string;
  databaseName: string;
  redactedTarget: string;
}>;

export class BootstrapClerkCliConfigurationError extends Error {
  constructor(
    public readonly code:
      | "DATABASE_URL_REQUIRED"
      | "INVALID_DATABASE_URL"
      | "DATABASE_CONFIRMATION_MISMATCH"
      | "TEST_DATABASE_TARGET_FORBIDDEN",
  ) {
    super(code);
    this.name = "BootstrapClerkCliConfigurationError";
  }
}

export const bootstrapClerkCliHelp = `Usage:
  pnpm bootstrap:clerk \\
    --teacher-subject user_... \\
    --teacher-name "Teacher name" \\
    --student-subject user_... \\
    --student-name "Student name" \\
    --student-roster-key <operator-managed-roster-key> \\
    --classroom-id <uuid> \\
    --classroom-name "Classroom name" \\
    --confirm-database <database-name>

The two Clerk users must already exist. This command never calls Clerk and
never changes an existing role, display name, classroom manager, classroom
name, or assigned roster key. It may fill a previously empty student roster
key. It reads DATABASE_URL only; --confirm-database must match its database.
`;

export function parseBootstrapClerkCliArguments(
  args: readonly string[],
): ParsedBootstrapClerkCli {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  const { values } = parseArgs({
    args: [...normalizedArgs],
    allowPositionals: false,
    strict: true,
    options: {
      help: { type: "boolean", default: false },
      "teacher-subject": { type: "string" },
      "teacher-name": { type: "string" },
      "student-subject": { type: "string" },
      "student-name": { type: "string" },
      "student-roster-key": { type: "string" },
      "classroom-id": { type: "string" },
      "classroom-name": { type: "string" },
      "confirm-database": { type: "string" },
    },
  });

  if (values.help) {
    return { kind: "help" };
  }

  const options = runOptionsSchema.parse({
    teacherSubject: values["teacher-subject"],
    teacherName: values["teacher-name"],
    studentSubject: values["student-subject"],
    studentName: values["student-name"],
    ...(values["student-roster-key"]
      ? { studentRosterKey: values["student-roster-key"] }
      : {}),
    classroomId: values["classroom-id"],
    classroomName: values["classroom-name"],
    confirmDatabase: values["confirm-database"],
  });
  const input = bootstrapClerkClassroomInputSchema.parse({
    teacherAuthSubject: options.teacherSubject,
    teacherDisplayName: options.teacherName,
    studentAuthSubject: options.studentSubject,
    studentDisplayName: options.studentName,
    ...(options.studentRosterKey
      ? { studentRosterKey: options.studentRosterKey }
      : {}),
    classroomId: options.classroomId,
    classroomName: options.classroomName,
  });

  return {
    kind: "run",
    input,
    confirmedDatabase: options.confirmDatabase,
  };
}

type ParsedPostgresTarget = BootstrapDatabaseTarget & {
  comparisonKey: string;
};

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase();
  return lower === "localhost" || lower === "127.0.0.1" || lower === "[::1]"
    ? "loopback"
    : lower;
}

function parsePostgresTarget(connectionString: string): ParsedPostgresTarget {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new BootstrapClerkCliConfigurationError("INVALID_DATABASE_URL");
  }

  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !url.hostname
  ) {
    throw new BootstrapClerkCliConfigurationError("INVALID_DATABASE_URL");
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw new BootstrapClerkCliConfigurationError("INVALID_DATABASE_URL");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new BootstrapClerkCliConfigurationError("INVALID_DATABASE_URL");
  }

  const hostname = normalizeHostname(url.hostname);
  const port = url.port || "5432";
  return {
    connectionString,
    databaseName,
    redactedTarget: `${url.hostname.toLowerCase()}:${port}/${databaseName}`,
    comparisonKey: `${hostname}:${port}/${databaseName}`,
  };
}

export function resolveBootstrapDatabaseTarget(
  rawEnvironment: {
    databaseUrl?: string;
    testDatabaseUrl?: string;
  },
  confirmedDatabase: string,
): BootstrapDatabaseTarget {
  if (!rawEnvironment.databaseUrl?.trim()) {
    throw new BootstrapClerkCliConfigurationError(
      "DATABASE_URL_REQUIRED",
    );
  }
  const environment = databaseEnvironmentSchema.parse({
    databaseUrl: rawEnvironment.databaseUrl,
    testDatabaseUrl: rawEnvironment.testDatabaseUrl?.trim() || undefined,
  });
  const runtimeTarget = parsePostgresTarget(environment.databaseUrl);

  if (environment.testDatabaseUrl) {
    const testTarget = parsePostgresTarget(environment.testDatabaseUrl);
    if (runtimeTarget.comparisonKey === testTarget.comparisonKey) {
      throw new BootstrapClerkCliConfigurationError(
        "TEST_DATABASE_TARGET_FORBIDDEN",
      );
    }
  }

  if (confirmedDatabase.trim() !== runtimeTarget.databaseName) {
    throw new BootstrapClerkCliConfigurationError(
      "DATABASE_CONFIRMATION_MISMATCH",
    );
  }

  return {
    connectionString: runtimeTarget.connectionString,
    databaseName: runtimeTarget.databaseName,
    redactedTarget: runtimeTarget.redactedTarget,
  };
}

export function serializeBootstrapClerkCliError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return JSON.stringify(
      {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      null,
      2,
    );
  }
  if (error instanceof BootstrapClerkCliConfigurationError) {
    return JSON.stringify(
      { ok: false, error: { code: error.code } },
      null,
      2,
    );
  }
  if (error instanceof BootstrapClerkClassroomError) {
    return JSON.stringify(
      {
        ok: false,
        error: { code: error.code, resource: error.resource },
      },
      null,
      2,
    );
  }
  if (error instanceof TypeError && "code" in error) {
    return JSON.stringify(
      { ok: false, error: { code: "INVALID_ARGUMENTS" } },
      null,
      2,
    );
  }
  return JSON.stringify(
    { ok: false, error: { code: "BOOTSTRAP_FAILED" } },
    null,
    2,
  );
}

export function serializeBootstrapClerkCliSuccess(
  target: BootstrapDatabaseTarget,
  result: BootstrapClerkClassroomResult,
): string {
  return JSON.stringify(
    {
      ok: true,
      databaseTarget: target.redactedTarget,
      resources: result,
    },
    null,
    2,
  );
}
