import { Client } from "pg";
import { pathToFileURL } from "node:url";

import { stagingLocalIdentifier } from "../../../src/server/bootstrap/bootstrap-local-staging";
import { stableAgentAcceptanceError } from "./contracts";
import { writeAgentArtifact } from "./output";

type Queryable = Pick<Client, "query">;
type CleanupResult = Readonly<{
  targetCount: number;
  revokedCount: number;
  remainingCount: number;
}>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

export function configuredAgentIdentifiers(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly string[] {
  const get = (name: string): string => {
    const value = environment[name]?.trim();
    if (!value) throw new Error(`${name}_REQUIRED`);
    return value;
  };
  const primary = get("STAGING_TEST_PRIMARY_SCHOOL_CODE");
  const secondary = get("STAGING_TEST_SECONDARY_SCHOOL_CODE");
  const disabledSchool = get("STAGING_TEST_DISABLED_SCHOOL_CODE");
  return [
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "TEACHER",
      staffNo: get("STAGING_TEST_TEACHER_STAFF_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "STUDENT",
      studentNo: get("STAGING_TEST_STUDENT_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "STUDENT",
      studentNo: get("STAGING_TEST_OTHER_STUDENT_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: secondary,
      role: "TEACHER",
      staffNo: get("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: primary,
      role: "STUDENT",
      studentNo: get("STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO"),
    }),
    stagingLocalIdentifier({
      schoolCode: disabledSchool,
      role: "TEACHER",
      staffNo: get("STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO"),
    }),
  ];
}

export async function cleanupAgentSessions(
  client: Queryable,
  identifiers: readonly string[],
  now: Date = new Date(),
): Promise<CleanupResult> {
  if (identifiers.length !== 6 || new Set(identifiers).size !== 6) {
    throw new Error("STAGING_AGENT_ACCEPTANCE_CLEANUP_IDENTITIES_INVALID");
  }
  await client.query("BEGIN");
  try {
    const users = await client.query<{ user_id: string }>(
      `SELECT user_id
       FROM local_credentials
       WHERE identifier = ANY($1::text[])
       FOR UPDATE`,
      [identifiers],
    );
    const userIds = users.rows.map((row) => row.user_id);
    if (userIds.length !== 6 || new Set(userIds).size !== 6) {
      throw new Error("STAGING_AGENT_ACCEPTANCE_CLEANUP_IDENTITIES_MISSING");
    }
    const revoked = await client.query(
      `UPDATE auth_sessions
       SET revoked_at = $2
       WHERE user_id = ANY($1::uuid[])
         AND revoked_at IS NULL`,
      [userIds, now],
    );
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM auth_sessions
       WHERE user_id = ANY($1::uuid[])
         AND revoked_at IS NULL`,
      [userIds],
    );
    const remainingCount = Number(remaining.rows[0]?.count ?? "-1");
    if (remainingCount !== 0) {
      throw new Error("STAGING_AGENT_ACCEPTANCE_ACTIVE_SESSIONS_REMAIN");
    }
    await client.query("COMMIT");
    return {
      targetCount: userIds.length,
      revokedCount: revoked.rowCount ?? 0,
      remainingCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main(): Promise<void> {
  const marker = required("STAGING_RUN_MARKER");
  const client = new Client({ connectionString: required("DIRECT_URL") });
  await client.connect();
  try {
    const result = await cleanupAgentSessions(
      client,
      configuredAgentIdentifiers(),
    );
    await writeAgentArtifact(marker, "cleanup.json", {
      schema: "staging-agent-acceptance-cleanup.v1",
      status: "PASS",
      targetCount: result.targetCount,
      revokedCount: result.revokedCount,
      remainingCount: result.remainingCount,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
    process.stdout.write(
      '{"schema":"staging-agent-acceptance-cleanup.v1","status":"PASS"}\n',
    );
  } finally {
    await client.end();
  }
}

async function runCli(): Promise<void> {
  await main();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli().catch(async (error: unknown) => {
  try {
    await writeAgentArtifact(
      process.env.STAGING_RUN_MARKER?.trim() ?? "",
      "cleanup.json",
      {
        schema: "staging-agent-acceptance-cleanup.v1",
        status: "FAIL",
        checks: [{ code: stableAgentAcceptanceError(error), status: "FAIL" }],
        realStudentDataAllowed: false,
        productionDecision: "NO_GO",
      },
    );
  } catch {
    // Cleanup evidence remains fail-closed if the output path is invalid.
  }
  process.stdout.write(
    '{"schema":"staging-agent-acceptance-cleanup.v1","status":"FAIL"}\n',
  );
  process.exitCode = 1;
  });
}
