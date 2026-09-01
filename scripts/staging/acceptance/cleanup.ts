import { Client } from "pg";
import { pathToFileURL } from "node:url";

import { stagingLocalIdentifier } from "../../../src/server/bootstrap/bootstrap-local-staging";
import { stableAcceptanceErrorCode } from "./contracts";
import { writeAcceptanceArtifact } from "./output";

const expectedIdentityCount = 6;

type CleanupCheck = Readonly<{ code: string; status: "PASS" | "FAIL" }>;

export type SessionCleanupEvidence = Readonly<{
  schema: "staging-synthetic-acceptance-sessions.v1";
  status: "PASS" | "FAIL";
  checks: readonly CleanupCheck[];
  targetCount: number;
  revokedCount: number;
  remainingCount: number;
  realStudentDataAllowed: false;
  productionDecision: "NO_GO";
}>;

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value as object).length === keys.length &&
    keys.every((key) => key in (value as object));
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isPassingSessionCleanupEvidence(
  value: unknown,
): value is SessionCleanupEvidence {
  const checks = [
    "SYNTHETIC_IDENTITIES_RESOLVED",
    "SYNTHETIC_SESSIONS_REVOKED",
    "NO_ACTIVE_SYNTHETIC_SESSIONS",
  ];
  if (!exactObject(value, [
    "schema",
    "status",
    "checks",
    "targetCount",
    "revokedCount",
    "remainingCount",
    "realStudentDataAllowed",
    "productionDecision",
  ]) ||
    value.schema !== "staging-synthetic-acceptance-sessions.v1" ||
    value.status !== "PASS" ||
    value.realStudentDataAllowed !== false ||
    value.productionDecision !== "NO_GO" ||
    value.targetCount !== expectedIdentityCount ||
    !isCount(value.revokedCount) ||
    value.remainingCount !== 0 ||
    !Array.isArray(value.checks)) {
    return false;
  }
  const evidenceChecks: unknown[] = value.checks;
  return evidenceChecks.length === checks.length && checks.every((code) =>
    evidenceChecks.some((check) =>
      exactObject(check, ["code", "status"]) &&
      check.code === code &&
      check.status === "PASS",
    ),
  );
}

function passingEvidence(revokedCount: number): SessionCleanupEvidence {
  return {
    schema: "staging-synthetic-acceptance-sessions.v1",
    status: "PASS",
    checks: [
      { code: "SYNTHETIC_IDENTITIES_RESOLVED", status: "PASS" },
      { code: "SYNTHETIC_SESSIONS_REVOKED", status: "PASS" },
      { code: "NO_ACTIVE_SYNTHETIC_SESSIONS", status: "PASS" },
    ],
    targetCount: expectedIdentityCount,
    revokedCount,
    remainingCount: 0,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  };
}

export async function revokeAcceptanceSessions(
  client: Client,
  identifiers: readonly string[],
): Promise<SessionCleanupEvidence> {
  if (identifiers.length !== expectedIdentityCount ||
    new Set(identifiers).size !== expectedIdentityCount) {
    throw new Error("STAGING_ACCEPTANCE_LOCAL_IDENTITIES_INCOMPLETE");
  }
  await client.query("BEGIN");
  try {
    const resolved = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM local_credentials WHERE identifier = ANY($1::text[])",
      [identifiers],
    );
    if (resolved.rows[0]?.count !== String(expectedIdentityCount)) {
      throw new Error("STAGING_ACCEPTANCE_LOCAL_IDENTITIES_NOT_FOUND");
    }
    const revoked = await client.query(
      "UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id IN (SELECT user_id FROM local_credentials WHERE identifier = ANY($1::text[])) AND revoked_at IS NULL",
      [identifiers],
    );
    const remaining = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM auth_sessions WHERE user_id IN (SELECT user_id FROM local_credentials WHERE identifier = ANY($1::text[])) AND revoked_at IS NULL",
      [identifiers],
    );
    if (remaining.rows[0]?.count !== "0") {
      throw new Error("STAGING_ACCEPTANCE_ACTIVE_SESSIONS_REMAIN");
    }
    await client.query("COMMIT");
    return passingEvidence(revoked.rowCount ?? 0);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function configuredIdentifiers(): string[] {
  const primary = required("STAGING_TEST_PRIMARY_SCHOOL_CODE");
  const secondary = required("STAGING_TEST_SECONDARY_SCHOOL_CODE");
  const disabledSchool = required("STAGING_TEST_DISABLED_SCHOOL_CODE");
  return [
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "TEACHER",
      staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "STUDENT",
      studentNo: required("STAGING_TEST_STUDENT_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "STUDENT",
      studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: secondary,
      role: "TEACHER",
      staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "STUDENT",
      studentNo: required("STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: disabledSchool,
      role: "TEACHER",
      staffNo: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO"),
    }),
  ];
}

async function main(): Promise<void> {
  const marker = required("STAGING_RUN_MARKER");
  const client = new Client({ connectionString: required("DIRECT_URL") });
  try {
    await client.connect();
    const evidence = await revokeAcceptanceSessions(
      client,
      configuredIdentifiers(),
    );
    await writeAcceptanceArtifact(marker, "sessions.json", evidence);
    process.stdout.write(JSON.stringify({ schema: evidence.schema, status: evidence.status }) + "\n");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function runCli(): Promise<void> {
  await main().catch(async (error: unknown) => {
    const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
    const evidence = {
      schema: "staging-synthetic-acceptance-sessions.v1",
      status: "FAIL",
      checks: [{ code: stableAcceptanceErrorCode(error), status: "FAIL" }],
      targetCount: 0,
      revokedCount: 0,
      remainingCount: 0,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    } as const;
    try {
      await writeAcceptanceArtifact(marker, "sessions.json", evidence);
    } catch {
      // The command must not expose an unsafe fallback artifact.
    }
    process.stdout.write(
      `${JSON.stringify({ schema: evidence.schema, status: evidence.status })}\n`,
    );
    process.exitCode = 1;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
