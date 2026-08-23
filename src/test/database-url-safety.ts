type TestDatabaseIsolationInput = Readonly<{
  testDatabaseUrl: string | undefined;
  runtimeDatabaseUrl?: string | undefined;
  directDatabaseUrl?: string | undefined;
}>;

type E2eDatabaseIsolationInput = Readonly<{
  e2eDatabaseUrl: string | undefined;
  runtimeDatabaseUrl?: string | undefined;
  directDatabaseUrl?: string | undefined;
  testDatabaseUrl?: string | undefined;
}>;

const reservedDatabaseNames = new Set(["postgres", "template0", "template1"]);
const defaultLocalRuntimeDatabaseUrl =
  "postgresql://postgres:postgres@127.0.0.1:5432/cdas_next";
const dedicatedE2eDatabaseName = "cdas_next_e2e";

type DatabaseTarget = Readonly<{
  databaseName: string;
  hostname: string;
  identity: string;
}>;

function databaseTarget(value: string, label: string): DatabaseTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label}_INVALID`);
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(`${label}_INVALID`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  } catch {
    throw new Error(`${label}_INVALID`);
  }
  if (
    !url.hostname ||
    databaseName.length === 0 ||
    databaseName.includes("/") ||
    url.hash.length > 0
  ) {
    throw new Error(`${label}_INVALID`);
  }

  const hostname =
    url.hostname === "localhost" || url.hostname === "[::1]"
      ? "127.0.0.1"
      : url.hostname.toLowerCase();
  const port = url.port || "5432";
  return {
    databaseName,
    hostname,
    identity: `${hostname}:${port}/${databaseName}`,
  };
}

function databaseIdentity(value: string, label: string): string {
  return databaseTarget(value, label).identity;
}

export function requireIsolatedTestDatabaseUrl({
  testDatabaseUrl,
  runtimeDatabaseUrl,
  directDatabaseUrl,
}: TestDatabaseIsolationInput): string {
  const normalizedTestUrl = testDatabaseUrl?.trim();
  if (!normalizedTestUrl) {
    throw new Error("TEST_DATABASE_URL_REQUIRED");
  }

  const testIdentity = databaseIdentity(
    normalizedTestUrl,
    "TEST_DATABASE_URL",
  );
  const testDatabaseName = testIdentity.slice(testIdentity.lastIndexOf("/") + 1);
  if (reservedDatabaseNames.has(testDatabaseName)) {
    throw new Error("TEST_DATABASE_URL_RESERVED_DATABASE");
  }

  for (const [label, candidate] of [
    [
      "DATABASE_URL",
      runtimeDatabaseUrl?.trim() || defaultLocalRuntimeDatabaseUrl,
    ],
    ["DIRECT_URL", directDatabaseUrl],
  ] as const) {
    const normalizedCandidate = candidate?.trim();
    if (
      normalizedCandidate &&
      databaseIdentity(normalizedCandidate, label) === testIdentity
    ) {
      throw new Error("TEST_DATABASE_URL_NOT_ISOLATED");
    }
  }

  return normalizedTestUrl;
}

export function requireIsolatedE2eDatabaseUrl({
  e2eDatabaseUrl,
  runtimeDatabaseUrl,
  directDatabaseUrl,
  testDatabaseUrl,
}: E2eDatabaseIsolationInput): string {
  const normalizedE2eUrl = e2eDatabaseUrl?.trim();
  if (!normalizedE2eUrl) {
    throw new Error("E2E_DATABASE_URL_REQUIRED");
  }

  const e2eTarget = databaseTarget(
    normalizedE2eUrl,
    "E2E_DATABASE_URL",
  );
  if (reservedDatabaseNames.has(e2eTarget.databaseName)) {
    throw new Error("E2E_DATABASE_URL_RESERVED_DATABASE");
  }
  if (e2eTarget.hostname !== "127.0.0.1") {
    throw new Error("E2E_DATABASE_URL_LOCAL_REQUIRED");
  }
  if (e2eTarget.databaseName !== dedicatedE2eDatabaseName) {
    throw new Error("E2E_DATABASE_URL_DEDICATED_DATABASE_REQUIRED");
  }

  for (const [label, candidate] of [
    [
      "DATABASE_URL",
      runtimeDatabaseUrl?.trim() || defaultLocalRuntimeDatabaseUrl,
    ],
    ["DIRECT_URL", directDatabaseUrl],
    ["TEST_DATABASE_URL", testDatabaseUrl],
  ] as const) {
    const normalizedCandidate = candidate?.trim();
    if (
      normalizedCandidate &&
      databaseIdentity(normalizedCandidate, label) === e2eTarget.identity
    ) {
      throw new Error("E2E_DATABASE_URL_NOT_ISOLATED");
    }
  }

  return normalizedE2eUrl;
}
