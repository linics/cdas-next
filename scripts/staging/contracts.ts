export const stagingDataAcknowledgement = "synthetic-data-only-approved";
export const stagingAiAcknowledgement = "synthetic-data-cost-approved";

export type CheckStatus = "PASS" | "FAIL" | "NOT_RUN";

export type StagingCheck = Readonly<{
  code: string;
  status: CheckStatus;
  present?: boolean;
  value?: boolean;
}>;

export type StagingPreflightResult = Readonly<{
  schema: "staging-preflight.v1";
  status: "PASS" | "FAIL";
  checks: readonly StagingCheck[];
  stagingSyntheticDecision: "GO" | "NO_GO";
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

export type StagingEnvironment = Readonly<Record<string, string | undefined>>;

type DatabaseTarget = Readonly<{
  databaseName: string;
  identity: string;
  hostname: string;
  clusterIdentity: string;
  pooled: boolean;
  tls: boolean;
}>;

const reservedDatabaseNames = new Set(["postgres", "template0", "template1"]);
const protectedDatabaseNames = new Set([
  "cdas_next",
  "cdas_next_test",
  "cdas_next_e2e",
]);
const clerkUserIdPattern = /^user_[A-Za-z0-9]+$/u;
const modelPattern = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const stagingRunMarkerPattern = /^cdas-staging-[a-z0-9-]{8,80}$/u;

function value(environment: StagingEnvironment, name: string): string {
  return environment[name]?.trim() ?? "";
}

function check(
  code: string,
  condition: boolean,
  extras: Pick<StagingCheck, "present" | "value"> = {},
): StagingCheck {
  return {
    code,
    status: condition ? "PASS" : "FAIL",
    ...extras,
  };
}

function parseDatabaseTarget(rawValue: string): DatabaseTarget | undefined {
  try {
    const url = new URL(rawValue);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      return undefined;
    }
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//u, ""));
    if (
      !url.hostname ||
      !databaseName ||
      databaseName.includes("/") ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    const hostname = url.hostname
      .toLowerCase()
      .replace(/\.+$/u, "")
      .replace(/^\[|\]$/gu, "");
    const port = url.port || "5432";
    return {
      databaseName,
      hostname,
      clusterIdentity: clusterIdentity(hostname),
      identity: `${hostname}:${port}/${databaseName}`,
      pooled:
        hostname.includes("pooler") ||
        url.searchParams.get("pgbouncer")?.toLowerCase() === "true",
      tls: ["require", "verify-ca", "verify-full"].includes(
        url.searchParams.get("sslmode")?.toLowerCase() ?? "",
      ),
    };
  } catch {
    return undefined;
  }
}

function isRemote(target: DatabaseTarget | undefined): boolean {
  return Boolean(target && isPublicHostname(target.hostname));
}

function clusterIdentity(hostname: string): string {
  const [firstLabel, ...remainingLabels] = hostname.split(".");
  const canonicalFirstLabel = firstLabel?.endsWith("-pooler")
    ? firstLabel.slice(0, -"-pooler".length)
    : firstLabel;
  return [canonicalFirstLabel, ...remainingLabels].join(".");
}

function isValidStagingDatabaseName(databaseName: string): boolean {
  const segments = databaseName.toLowerCase().split(/[-_]/u);
  return (
    databaseName.length > 0 &&
    !reservedDatabaseNames.has(databaseName) &&
    !protectedDatabaseNames.has(databaseName) &&
    segments.includes("staging") &&
    !segments.includes("prod") &&
    !segments.includes("production")
  );
}

function noTargetOverlap(
  candidate: DatabaseTarget | undefined,
  rawValue: string,
): boolean {
  if (!rawValue) {
    return true;
  }
  const target = parseDatabaseTarget(rawValue);
  return Boolean(target && candidate && target.identity !== candidate.identity);
}

export function isSafeStagingRunMarker(marker: string): boolean {
  return stagingRunMarkerPattern.test(marker);
}

export function evaluateStagingPreflight(
  environment: StagingEnvironment,
): StagingPreflightResult {
  const runtimeUrl = value(environment, "DATABASE_URL");
  const directUrl = value(environment, "DIRECT_URL");
  const runtimeTarget = parseDatabaseTarget(runtimeUrl);
  const directTarget = parseDatabaseTarget(directUrl);
  const teacherId = value(environment, "STAGING_TEST_TEACHER_CLERK_ID");
  const studentId = value(environment, "STAGING_TEST_STUDENT_CLERK_ID");
  const aiDisabled = value(environment, "AI_PROVIDER_DISABLED") === "1";
  const aiEnabled = value(environment, "AI_PROVIDER_DISABLED") === "0";
  const gatewayKey = value(environment, "AI_GATEWAY_API_KEY");
  const model = value(environment, "AI_MODEL");
  const approvalSecret = value(environment, "AI_TOOL_APPROVAL_SECRET");

  const checks: StagingCheck[] = [
    check("STAGING_RUN_MARKER", isSafeStagingRunMarker(value(environment, "STAGING_RUN_MARKER"))),
    check(
      "STAGING_SYNTHETIC_DATA_ACK",
      value(environment, "STAGING_DATA_ACK") === stagingDataAcknowledgement,
    ),
    check("NODE_ENV_PRODUCTION", value(environment, "NODE_ENV") === "production"),
  ];

  const baseUrl = value(environment, "STAGING_BASE_URL");
  let parsedBaseUrl: URL | undefined;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    parsedBaseUrl = undefined;
  }
  checks.push(
    check(
      "STAGING_BASE_URL_HTTPS_REMOTE",
      Boolean(
        parsedBaseUrl &&
          parsedBaseUrl.protocol === "https:" &&
          isPublicHostname(parsedBaseUrl.hostname) &&
          !parsedBaseUrl.username &&
          !parsedBaseUrl.password &&
          !parsedBaseUrl.search &&
          !parsedBaseUrl.hash &&
          (parsedBaseUrl.pathname === "" || parsedBaseUrl.pathname === "/"),
      ),
      { present: Boolean(baseUrl) },
    ),
  );

  checks.push(
    check("DATABASE_URL_REMOTE_POOLED", Boolean(runtimeTarget && isRemote(runtimeTarget) && runtimeTarget.pooled), {
      present: Boolean(runtimeUrl),
    }),
    check("DIRECT_URL_REMOTE_DIRECT", Boolean(directTarget && isRemote(directTarget) && !directTarget.pooled), {
      present: Boolean(directUrl),
    }),
    check("DATABASE_URL_TLS_REQUIRED", Boolean(runtimeTarget?.tls), {
      present: Boolean(runtimeUrl),
    }),
    check("DIRECT_URL_TLS_REQUIRED", Boolean(directTarget?.tls), {
      present: Boolean(directUrl),
    }),
    check(
      "STAGING_DATABASE_NAME_ACKNOWLEDGED",
      Boolean(
        runtimeTarget &&
          directTarget &&
          runtimeTarget.databaseName === directTarget.databaseName &&
          runtimeTarget.databaseName === value(environment, "STAGING_DATABASE_NAME") &&
          isValidStagingDatabaseName(runtimeTarget.databaseName),
      ),
    ),
    check(
      "DATABASE_RUNTIME_DIRECT_TARGETS_DISTINCT",
      Boolean(runtimeTarget && directTarget && runtimeTarget.identity !== directTarget.identity),
    ),
    check(
      "DATABASE_RUNTIME_DIRECT_CLUSTER_MATCH",
      Boolean(
        runtimeTarget &&
          directTarget &&
          runtimeTarget.clusterIdentity === directTarget.clusterIdentity &&
          runtimeTarget.databaseName === directTarget.databaseName,
      ),
    ),
    check(
      "DATABASE_URL_ISOLATED_FROM_TEST_AND_E2E",
      noTargetOverlap(runtimeTarget, value(environment, "TEST_DATABASE_URL")) &&
        noTargetOverlap(runtimeTarget, value(environment, "E2E_DATABASE_URL")) &&
        noTargetOverlap(directTarget, value(environment, "TEST_DATABASE_URL")) &&
        noTargetOverlap(directTarget, value(environment, "E2E_DATABASE_URL")),
    ),
  );

  const publishableKey = value(environment, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  const secretKey = value(environment, "CLERK_SECRET_KEY");
  const healthProofSecret = value(environment, "STAGING_HEALTH_PROOF_SECRET");
  checks.push(
    check("CLERK_TEST_PUBLISHABLE_KEY", /^pk_test_[A-Za-z0-9_-]{10,}$/u.test(publishableKey), {
      present: Boolean(publishableKey),
    }),
    check("CLERK_TEST_SECRET_KEY", /^sk_test_[A-Za-z0-9_-]{10,}$/u.test(secretKey), {
      present: Boolean(secretKey),
    }),
    check("STAGING_TEST_TEACHER_CLERK_ID", clerkUserIdPattern.test(teacherId), {
      present: Boolean(teacherId),
    }),
    check("STAGING_TEST_STUDENT_CLERK_ID", clerkUserIdPattern.test(studentId), {
      present: Boolean(studentId),
    }),
    check(
      "STAGING_TEST_CLERK_IDS_DISTINCT",
      clerkUserIdPattern.test(teacherId) &&
        clerkUserIdPattern.test(studentId) &&
        teacherId !== studentId,
    ),
    check(
      "CDAS_DEPLOYMENT_ID",
      /^[a-f0-9]{40}$/u.test(value(environment, "CDAS_DEPLOYMENT_ID")),
      { present: Boolean(value(environment, "CDAS_DEPLOYMENT_ID")) },
    ),
    check(
      "STAGING_HEALTH_PROOF_SECRET",
      Buffer.byteLength(healthProofSecret, "utf8") >= 32 &&
        Buffer.byteLength(healthProofSecret, "utf8") <= 4_096,
      { present: Boolean(healthProofSecret) },
    ),
  );

  checks.push(
    check("AI_PROVIDER_DISABLED_OR_EXPLICITLY_ENABLED", aiDisabled || aiEnabled),
    check(
      "AI_PROVIDER_SYNTHETIC_ACK",
      aiDisabled || value(environment, "STAGING_AI_ACK") === stagingAiAcknowledgement,
    ),
    check(
      "AI_GATEWAY_CONFIG_WHEN_ENABLED",
      aiDisabled ||
        (gatewayKey.length >= 16 &&
          gatewayKey.length <= 2_000 &&
          model.length <= 200 &&
          modelPattern.test(model) &&
          approvalSecret.length >= 32 &&
          approvalSecret.length <= 4_096),
      {
        present: Boolean(gatewayKey || model || approvalSecret),
      },
    ),
  );

  const status = checks.every((candidate) => candidate.status === "PASS")
    ? "PASS"
    : "FAIL";
  return {
    schema: "staging-preflight.v1",
    status,
    checks,
    stagingSyntheticDecision: status === "PASS" ? "GO" : "NO_GO",
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

export function hasSafeDatabaseVerifierConfiguration(
  environment: StagingEnvironment,
): boolean {
  const runtime = parseDatabaseTarget(value(environment, "DATABASE_URL"));
  const direct = parseDatabaseTarget(value(environment, "DIRECT_URL"));
  return Boolean(
    runtime && direct &&
      isRemote(runtime) && isRemote(direct) &&
      runtime.pooled && !direct.pooled && runtime.tls && direct.tls &&
      runtime.databaseName === direct.databaseName &&
      runtime.databaseName === value(environment, "STAGING_DATABASE_NAME") &&
      isValidStagingDatabaseName(runtime.databaseName) &&
      runtime.identity !== direct.identity &&
      runtime.clusterIdentity === direct.clusterIdentity &&
      noTargetOverlap(runtime, value(environment, "TEST_DATABASE_URL")) &&
      noTargetOverlap(runtime, value(environment, "E2E_DATABASE_URL")) &&
      noTargetOverlap(direct, value(environment, "TEST_DATABASE_URL")) &&
      noTargetOverlap(direct, value(environment, "E2E_DATABASE_URL")),
  );
}
import { isPublicHostname } from "../../src/server/staging/deployment-proof";
