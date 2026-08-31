import {
  authenticate,
  revokeUserSessions,
} from "../../../src/server/auth/local-auth";
import { stagingLocalIdentifier } from "../../../src/server/bootstrap/bootstrap-local-staging";
import { createDatabaseClient } from "../../../src/server/db/client";
import { stableAgentAcceptanceError } from "./contracts";
import { writeAgentArtifact } from "./output";
import { assertAgentIdentityPrerequisites } from "./prerequisites";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

async function main(): Promise<void> {
  await assertAgentIdentityPrerequisites(process.env);
  const marker = required("STAGING_RUN_MARKER");
  const primary = required("STAGING_TEST_PRIMARY_SCHOOL_CODE");
  const secondary = required("STAGING_TEST_SECONDARY_SCHOOL_CODE");
  const identities = [
    {
      code: "TEACHER_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "TEACHER",
        staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
      }),
      password: required("STAGING_TEST_TEACHER_PASSWORD"),
      role: "TEACHER" as const,
    },
    {
      code: "STUDENT_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_STUDENT_NO"),
      }),
      password: required("STAGING_TEST_STUDENT_PASSWORD"),
      role: "STUDENT" as const,
    },
    {
      code: "OTHER_STUDENT_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
      }),
      password: required("STAGING_TEST_OTHER_STUDENT_PASSWORD"),
      role: "STUDENT" as const,
    },
    {
      code: "OTHER_TEACHER_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: secondary,
        role: "TEACHER",
        staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
      }),
      password: required("STAGING_TEST_OTHER_TEACHER_PASSWORD"),
      role: "TEACHER" as const,
    },
  ];
  const database = createDatabaseClient(required("DIRECT_URL"));
  const checks: Array<{ code: string; status: "PASS" }> = [];
  try {
    for (const identity of identities) {
      const result = await authenticate(
        database,
        identity.identifier,
        identity.password,
        identity.role,
      );
      if (!result.ok) {
        throw new Error(`STAGING_AGENT_${identity.code}_${result.code}`);
      }
      await revokeUserSessions(database, result.userId);
      checks.push({ code: identity.code, status: "PASS" });
    }
  } finally {
    await database.$disconnect();
  }
  await writeAgentArtifact(marker, "identity.json", {
    schema: "staging-agent-acceptance-identity.v1",
    status: "PASS",
    checks,
    sessionsRevoked: true,
    realStudentDataAllowed: false,
    productionDecision: "NO_GO",
  });
  process.stdout.write(
    '{"schema":"staging-agent-acceptance-identity.v1","status":"PASS"}\n',
  );
}

void main().catch(async (error: unknown) => {
  try {
    await writeAgentArtifact(
      process.env.STAGING_RUN_MARKER?.trim() ?? "",
      "identity.json",
      {
        schema: "staging-agent-acceptance-identity.v1",
        status: "FAIL",
        checks: [{ code: stableAgentAcceptanceError(error), status: "FAIL" }],
        sessionsRevoked: false,
        realStudentDataAllowed: false,
        productionDecision: "NO_GO",
      },
    );
  } catch {
    // The safe output path is intentionally fail-closed.
  }
  process.stdout.write(
    '{"schema":"staging-agent-acceptance-identity.v1","status":"FAIL"}\n',
  );
  process.exitCode = 1;
});
