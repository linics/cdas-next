import { createDatabaseClient } from "../../../src/server/db/client";
import { authenticate, revokeUserSessions } from "../../../src/server/auth/local-auth";
import { stagingLocalIdentifier } from "../../../src/server/bootstrap/bootstrap-local-staging";
import { stableAcceptanceErrorCode } from "./contracts";
import { writeAcceptanceArtifact } from "./output";
import { assertIdentityPrerequisites } from "./prerequisites";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
};

async function main(): Promise<void> {
  await assertIdentityPrerequisites(process.env);
  const marker = required("STAGING_RUN_MARKER");
  const primary = required("STAGING_TEST_PRIMARY_SCHOOL_CODE");
  const secondary = required("STAGING_TEST_SECONDARY_SCHOOL_CODE");
  const identities = [
    {
      name: "TEACHER",
      identity: {
        identifier: stagingLocalIdentifier({
          schoolCode: primary,
          role: "TEACHER",
          staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
        }),
        password: required("STAGING_TEST_TEACHER_PASSWORD"),
        role: "TEACHER" as const,
      },
    },
    {
      name: "STUDENT",
      identity: {
        identifier: stagingLocalIdentifier({
          schoolCode: primary,
          role: "STUDENT",
          studentNo: required("STAGING_TEST_STUDENT_NO"),
        }),
        password: required("STAGING_TEST_STUDENT_PASSWORD"),
        role: "STUDENT" as const,
      },
    },
    {
      name: "OTHER_STUDENT",
      identity: {
        identifier: stagingLocalIdentifier({
          schoolCode: primary,
          role: "STUDENT",
          studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
        }),
        password: required("STAGING_TEST_OTHER_STUDENT_PASSWORD"),
        role: "STUDENT" as const,
      },
    },
    {
      name: "OTHER_TEACHER",
      identity: {
        identifier: stagingLocalIdentifier({
          schoolCode: secondary,
          role: "TEACHER",
          staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
        }),
        password: required("STAGING_TEST_OTHER_TEACHER_PASSWORD"),
        role: "TEACHER" as const,
      },
    },
  ];
  const disabledAccount = {
    identifier: stagingLocalIdentifier({
      schoolCode: primary,
      role: "STUDENT",
      studentNo: required("STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO"),
    }),
    password: required("STAGING_TEST_DISABLED_ACCOUNT_PASSWORD"),
    role: "STUDENT" as const,
  };
  const disabledSchool = {
    identifier: stagingLocalIdentifier({
      schoolCode: required("STAGING_TEST_DISABLED_SCHOOL_CODE"),
      role: "TEACHER",
      staffNo: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO"),
    }),
    password: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD"),
    role: "TEACHER" as const,
  };
  const teacher = identities[0].identity;
  const database = createDatabaseClient(required("DIRECT_URL"));
  const checks: { code: string; status: "PASS" }[] = [];
  try {
    for (const { name, identity } of identities) {
      const result = await authenticate(database, identity.identifier, identity.password, identity.role);
      if (!result.ok) throw new Error(`STAGING_ACCEPTANCE_${name}_AUTHENTICATION_${result.code}`);
      await revokeUserSessions(database, result.userId);
      checks.push({ code: `${name}_LOCAL_AUTHENTICATES`, status: "PASS" });
    }
    const wrongSchoolIdentifier = stagingLocalIdentifier({
      schoolCode: secondary,
      role: "TEACHER",
      staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
    });
    const wrongSchool = await authenticate(
      database,
      wrongSchoolIdentifier,
      teacher.password,
      "TEACHER",
    );
    if (wrongSchool.ok || wrongSchool.code !== "INVALID_CREDENTIALS") throw new Error("STAGING_ACCEPTANCE_WRONG_SCHOOL_NOT_INVALID_CREDENTIALS");
    checks.push({ code: "WRONG_SCHOOL_INVALID_CREDENTIALS", status: "PASS" });
    const disabledAccountResult = await authenticate(database, disabledAccount.identifier, disabledAccount.password, disabledAccount.role);
    if (disabledAccountResult.ok || disabledAccountResult.code !== "ACCOUNT_DISABLED") throw new Error("STAGING_ACCEPTANCE_DISABLED_ACCOUNT_CODE_MISMATCH");
    checks.push({ code: "DISABLED_ACCOUNT_ACCOUNT_DISABLED", status: "PASS" });
    const disabledSchoolResult = await authenticate(database, disabledSchool.identifier, disabledSchool.password, disabledSchool.role);
    if (disabledSchoolResult.ok || disabledSchoolResult.code !== "SCHOOL_DISABLED") throw new Error("STAGING_ACCEPTANCE_DISABLED_SCHOOL_CODE_MISMATCH");
    checks.push({ code: "DISABLED_SCHOOL_SCHOOL_DISABLED", status: "PASS" });
  } finally {
    for (const { identity } of identities) identity.password = "";
    disabledAccount.password = "";
    disabledSchool.password = "";
    await database.$disconnect();
  }
  const evidence = { schema: "staging-synthetic-acceptance-identity.v1", status: "PASS", checks, directSessionsRevoked: true, realStudentDataAllowed: false, productionDecision: "NO_GO" } as const;
  await writeAcceptanceArtifact(marker, "identity.json", evidence);
  process.stdout.write(`${JSON.stringify({ schema: evidence.schema, status: evidence.status })}\n`);
}

void main().catch(async (error: unknown) => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try {
    await writeAcceptanceArtifact(marker, "identity.json", {
      schema: "staging-synthetic-acceptance-identity.v1",
      status: "FAIL",
      checks: [{ code: stableAcceptanceErrorCode(error), status: "FAIL" }],
      directSessionsRevoked: false,
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
  } catch {
    /* safe artifact path only */
  }
  process.stdout.write('{"schema":"staging-synthetic-acceptance-identity.v1","status":"FAIL"}\n');
  process.exitCode = 1;
});
