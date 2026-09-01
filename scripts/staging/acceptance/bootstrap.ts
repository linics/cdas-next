import nextEnvironment from "@next/env";

import { bootstrapLocalStaging, stagingLocalIdentifier } from "../../../src/server/bootstrap/bootstrap-local-staging";
import { createDatabaseClient } from "../../../src/server/db/client";
import {
  acceptanceNamespace,
  acceptanceOtherStudentDisplayName,
  acceptanceOtherTeacherDisplayName,
  acceptanceStudentDisplayName,
  acceptanceTeacherDisplayName,
  evaluateAcceptanceReadiness,
  stableAcceptanceErrorCode,
} from "./contracts";
import {
  assertNoAcceptanceBusinessHistory,
  probeAcceptanceNamespace,
} from "./fixture";
import { writeAcceptanceArtifact } from "./output";
import { assertBootstrapPrerequisites } from "./prerequisites";

function required(name: string): string {
  const result = process.env[name]?.trim();
  if (!result) throw new Error(`${name}_REQUIRED`);
  return result;
}

type StagingIdentity = {
  schoolCode: string;
  identifier: string;
  password: string;
  displayName: string;
  role: "TEACHER" | "STUDENT";
  staffNo?: string;
  studentNo?: string;
  accountStatus?: "ACTIVE" | "DISABLED";
};

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(process.cwd());
  const marker = required("STAGING_RUN_MARKER");
  const readiness = evaluateAcceptanceReadiness(process.env, { requireBypassSecret: false });
  if (readiness.status !== "PASS") throw new Error("STAGING_ACCEPTANCE_READINESS_FAILED");
  await assertBootstrapPrerequisites(process.env);
  const namespace = acceptanceNamespace(marker);
  const database = createDatabaseClient(required("DIRECT_URL"));
  let identities: StagingIdentity[] = [];
  try {
    const primarySchoolCode = required("STAGING_TEST_PRIMARY_SCHOOL_CODE");
    const secondarySchoolCode = required("STAGING_TEST_SECONDARY_SCHOOL_CODE");
    const teacherIdentifier = stagingLocalIdentifier({ schoolCode: primarySchoolCode, role: "TEACHER", staffNo: required("STAGING_TEST_TEACHER_STAFF_NO") });
    const studentIdentifier = stagingLocalIdentifier({ schoolCode: primarySchoolCode, role: "STUDENT", studentNo: required("STAGING_TEST_STUDENT_NO") });
    const otherStudentIdentifier = stagingLocalIdentifier({ schoolCode: primarySchoolCode, role: "STUDENT", studentNo: required("STAGING_TEST_OTHER_STUDENT_NO") });
    const otherTeacherIdentifier = stagingLocalIdentifier({ schoolCode: secondarySchoolCode, role: "TEACHER", staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO") });
    const disabledSchoolCode = required("STAGING_TEST_DISABLED_SCHOOL_CODE");
    const disabledAccountStudentNo = required("STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO");
    const disabledSchoolTeacherStaffNo = required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO");
    await assertNoAcceptanceBusinessHistory(database, teacherIdentifier, namespace.activityTitle);
    const probe = await probeAcceptanceNamespace(database, namespace.classroomId, namespace.classroomName, teacherIdentifier, studentIdentifier, otherStudentIdentifier);
    if (probe === "COLLISION") throw new Error("STAGING_ACCEPTANCE_NAMESPACE_COLLISION");
    identities = [
      {
        schoolCode: primarySchoolCode,
        identifier: teacherIdentifier,
        password: required("STAGING_TEST_TEACHER_PASSWORD"),
        displayName: acceptanceTeacherDisplayName,
        role: "TEACHER" as const,
        staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
      },
      {
        schoolCode: primarySchoolCode,
        identifier: studentIdentifier,
        password: required("STAGING_TEST_STUDENT_PASSWORD"),
        displayName: acceptanceStudentDisplayName,
        role: "STUDENT" as const,
        studentNo: required("STAGING_TEST_STUDENT_NO"),
      },
      {
        schoolCode: primarySchoolCode,
        identifier: otherStudentIdentifier,
        password: required("STAGING_TEST_OTHER_STUDENT_PASSWORD"),
        displayName: acceptanceOtherStudentDisplayName,
        role: "STUDENT" as const,
        studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
      },
      {
        schoolCode: secondarySchoolCode,
        identifier: otherTeacherIdentifier,
        password: required("STAGING_TEST_OTHER_TEACHER_PASSWORD"),
        displayName: acceptanceOtherTeacherDisplayName,
        role: "TEACHER" as const,
        staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
      },
      {
        schoolCode: primarySchoolCode,
        identifier: stagingLocalIdentifier({
          schoolCode: primarySchoolCode,
          role: "STUDENT",
          studentNo: disabledAccountStudentNo,
        }),
        password: required("STAGING_TEST_DISABLED_ACCOUNT_PASSWORD"),
        displayName: "CDAS Staging Synthetic Disabled Account",
        role: "STUDENT" as const,
        studentNo: disabledAccountStudentNo,
        accountStatus: "DISABLED" as const,
      },
      {
        schoolCode: disabledSchoolCode,
        identifier: stagingLocalIdentifier({
          schoolCode: disabledSchoolCode,
          role: "TEACHER",
          staffNo: disabledSchoolTeacherStaffNo,
        }),
        password: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD"),
        displayName: "CDAS Staging Synthetic Disabled School Teacher",
        role: "TEACHER" as const,
        staffNo: disabledSchoolTeacherStaffNo,
      },
    ];
    const result = await bootstrapLocalStaging(database, {
      schools: [
        { code: primarySchoolCode, name: "CDAS Staging Synthetic School A", status: "ACTIVE" },
        { code: secondarySchoolCode, name: "CDAS Staging Synthetic School B", status: "ACTIVE" },
        { code: disabledSchoolCode, name: "CDAS Staging Synthetic School C", status: "DISABLED" },
      ],
      identities,
      classroom: { id: namespace.classroomId, name: namespace.classroomName, teacherIdentifier, studentIdentifiers: [studentIdentifier, otherStudentIdentifier] },
    });
    await writeAcceptanceArtifact(marker, "bootstrap.json", {
      schema: "staging-synthetic-acceptance-bootstrap.v1",
      status: "PASS",
      namespace: { marker, classroomDerived: true },
      collisionProbe: probe,
      resources: {
        teacher: result.identities[teacherIdentifier],
        student: result.identities[studentIdentifier],
        otherStudent: result.identities[otherStudentIdentifier],
        otherTeacher: result.identities[otherTeacherIdentifier],
        classroom: result.classroom,
        membership: result.memberships > 0 ? "CREATED" : "EXISTING",
        otherMembership: result.memberships > 1 ? "CREATED" : "EXISTING",
      },
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
    process.stdout.write('{"schema":"staging-synthetic-acceptance-bootstrap.v1","status":"PASS"}\n');
  } finally {
    for (const identity of identities) identity.password = "";
    await database.$disconnect();
  }
}

void main().catch(async (error: unknown) => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try { await writeAcceptanceArtifact(marker, "bootstrap.json", { schema: "staging-synthetic-acceptance-bootstrap.v1", status: "FAIL", checks: [{ code: stableAcceptanceErrorCode(error), status: "FAIL" }], realStudentDataAllowed: false, productionDecision: "NO_GO" }); } catch { /* output path must not be weakened */ }
  process.stdout.write(`{"schema":"staging-synthetic-acceptance-bootstrap.v1","status":"FAIL","code":"${stableAcceptanceErrorCode(error)}"}\n`);
  process.exitCode = 1;
});
