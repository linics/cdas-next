import { z } from "zod";

const databaseEnvironmentSchema = z
  .object({
    databaseUrl: z.string().trim().min(1),
    testDatabaseUrl: z.string().trim().min(1).optional(),
  })
  .strict();

export type BootstrapDatabaseTarget = Readonly<{
  connectionString: string;
  databaseName: string;
  redactedTarget: string;
}>;

export class BootstrapDatabaseConfigurationError extends Error {
  constructor(
    public readonly code:
      | "DATABASE_URL_REQUIRED"
      | "INVALID_DATABASE_URL"
      | "DATABASE_CONFIRMATION_MISMATCH"
      | "TEST_DATABASE_TARGET_FORBIDDEN",
  ) {
    super(code);
    this.name = "BootstrapDatabaseConfigurationError";
  }
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
    throw new BootstrapDatabaseConfigurationError("INVALID_DATABASE_URL");
  }
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !url.hostname
  ) {
    throw new BootstrapDatabaseConfigurationError("INVALID_DATABASE_URL");
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    throw new BootstrapDatabaseConfigurationError("INVALID_DATABASE_URL");
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new BootstrapDatabaseConfigurationError("INVALID_DATABASE_URL");
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
    throw new BootstrapDatabaseConfigurationError("DATABASE_URL_REQUIRED");
  }
  const environment = databaseEnvironmentSchema.parse({
    databaseUrl: rawEnvironment.databaseUrl,
    testDatabaseUrl: rawEnvironment.testDatabaseUrl?.trim() || undefined,
  });
  const runtimeTarget = parsePostgresTarget(environment.databaseUrl);
  if (environment.testDatabaseUrl) {
    const testTarget = parsePostgresTarget(environment.testDatabaseUrl);
    if (runtimeTarget.comparisonKey === testTarget.comparisonKey) {
      throw new BootstrapDatabaseConfigurationError(
        "TEST_DATABASE_TARGET_FORBIDDEN",
      );
    }
  }
  if (confirmedDatabase.trim() !== runtimeTarget.databaseName) {
    throw new BootstrapDatabaseConfigurationError(
      "DATABASE_CONFIRMATION_MISMATCH",
    );
  }
  return {
    connectionString: runtimeTarget.connectionString,
    databaseName: runtimeTarget.databaseName,
    redactedTarget: runtimeTarget.redactedTarget,
  };
}
