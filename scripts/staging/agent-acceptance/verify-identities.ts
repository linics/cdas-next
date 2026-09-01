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

type Identity = {
  code: string;
  identifier: string;
  password: string;
  role: "TEACHER" | "STUDENT";
  expectedSchoolStatus: "ACTIVE" | "DISABLED";
  expectedAccountStatus: "ACTIVE" | "DISABLED";
  expectedFailureCode?: "ACCOUNT_DISABLED" | "SCHOOL_DISABLED";
};

async function main(): Promise<void> {
  await assertAgentIdentityPrerequisites(process.env);
  const marker = required("STAGING_RUN_MARKER");
  const primary = required("STAGING_TEST_PRIMARY_SCHOOL_CODE");
  const secondary = required("STAGING_TEST_SECONDARY_SCHOOL_CODE");
  const disabledSchool = required("STAGING_TEST_DISABLED_SCHOOL_CODE");
  const identities: Identity[] = [
    {
      code: "TEACHER_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "TEACHER",
        staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
      }),
      password: required("STAGING_TEST_TEACHER_PASSWORD"),
      role: "TEACHER",
      expectedSchoolStatus: "ACTIVE",
      expectedAccountStatus: "ACTIVE",
    },
    {
      code: "STUDENT_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_STUDENT_NO"),
      }),
      password: required("STAGING_TEST_STUDENT_PASSWORD"),
      role: "STUDENT",
      expectedSchoolStatus: "ACTIVE",
      expectedAccountStatus: "ACTIVE",
    },
    {
      code: "OTHER_STUDENT_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
      }),
      password: required("STAGING_TEST_OTHER_STUDENT_PASSWORD"),
      role: "STUDENT",
      expectedSchoolStatus: "ACTIVE",
      expectedAccountStatus: "ACTIVE",
    },
    {
      code: "OTHER_TEACHER_LOCAL_AUTHENTICATES",
      identifier: stagingLocalIdentifier({
        schoolCode: secondary,
        role: "TEACHER",
        staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
      }),
      password: required("STAGING_TEST_OTHER_TEACHER_PASSWORD"),
      role: "TEACHER",
      expectedSchoolStatus: "ACTIVE",
      expectedAccountStatus: "ACTIVE",
    },
    {
      code: "DISABLED_ACCOUNT_IS_REJECTED",
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO"),
      }),
      password: required("STAGING_TEST_DISABLED_ACCOUNT_PASSWORD"),
      role: "STUDENT",
      expectedSchoolStatus: "ACTIVE",
      expectedAccountStatus: "DISABLED",
      expectedFailureCode: "ACCOUNT_DISABLED",
    },
    {
      code: "DISABLED_SCHOOL_IS_REJECTED",
      identifier: stagingLocalIdentifier({
        schoolCode: disabledSchool,
        role: "TEACHER",
        staffNo: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO"),
      }),
      password: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD"),
      role: "TEACHER",
      expectedSchoolStatus: "DISABLED",
      expectedAccountStatus: "ACTIVE",
      expectedFailureCode: "SCHOOL_DISABLED",
    },
  ];
  const database = createDatabaseClient(required("DIRECT_URL"));
  const userIds = new Set<string>();
  const checks: Array<{ code: string; status: "PASS" }> = [];
  try {
    for (const identity of identities) {
      const credential = await database.localCredential.findUnique({
        where: { identifier: identity.identifier },
        select: {
          user: {
            select: {
              id: true,
              role: true,
              accountStatus: true,
              school: { select: { status: true } },
            },
          },
        },
      });
      if (
        !credential ||
        credential.user.role !== identity.role ||
        credential.user.accountStatus !== identity.expectedAccountStatus ||
        credential.user.school?.status !== identity.expectedSchoolStatus
      ) {
        throw new Error(`STAGING_AGENT_${identity.code}_PROFILE_MISMATCH`);
      }
      userIds.add(credential.user.id);
      const result = await authenticate(
        database,
        identity.identifier,
        identity.password,
        identity.role,
      );
      const shouldPass =
        identity.expectedAccountStatus === "ACTIVE" &&
        identity.expectedSchoolStatus === "ACTIVE";
      if (shouldPass && (!result.ok || result.userId !== credential.user.id)) {
        throw new Error(`STAGING_AGENT_${identity.code}_AUTHENTICATION_FAILED`);
      }
      if (
        !shouldPass &&
        (result.ok || result.code !== identity.expectedFailureCode)
      ) {
        throw new Error(`STAGING_AGENT_${identity.code}_NEGATIVE_BOUNDARY_FAILED`);
      }
      checks.push({ code: identity.code, status: "PASS" });
    }
    const wrongSchoolIdentifier = stagingLocalIdentifier({
      schoolCode: secondary,
      role: "TEACHER",
      staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
    });
    const wrongSchool = await authenticate(
      database,
      wrongSchoolIdentifier,
      identities[0]?.password ?? "",
      "TEACHER",
    );
    if (wrongSchool.ok || wrongSchool.code !== "INVALID_CREDENTIALS") {
      throw new Error("STAGING_AGENT_CROSS_SCHOOL_BOUNDARY_FAILED");
    }
    checks.push({ code: "CROSS_SCHOOL_IDENTIFIER_REJECTED", status: "PASS" });
  } finally {
    for (const identity of identities) identity.password = "";
    for (const userId of userIds) await revokeUserSessions(database, userId);
    await database.$disconnect();
  }
  await writeAgentArtifact(marker, "identity.json", {
    schema: "staging-agent-acceptance-identity.v1",
    status: "PASS",
    checks,
    directSessionsRevoked: true,
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
        directSessionsRevoked: false,
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
