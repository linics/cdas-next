import nextEnvironment from "@next/env";

import {
  bootstrapAdditionalClerkClassroomStudent,
  bootstrapClerkClassroom,
  bootstrapStandaloneClerkTeacher,
} from "../../../src/server/bootstrap/bootstrap-clerk-classroom";
import { createDatabaseClient } from "../../../src/server/db/client";
import {
  acceptanceNamespace,
  acceptanceOtherStudentDisplayName,
  acceptanceOtherStudentRosterKey,
  acceptanceOtherTeacherDisplayName,
  acceptanceStudentDisplayName,
  acceptanceStudentRosterKey,
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

async function main(): Promise<void> {
  nextEnvironment.loadEnvConfig(process.cwd());
  const marker = required("STAGING_RUN_MARKER");
  const readiness = evaluateAcceptanceReadiness(process.env, { requireBypassSecret: false });
  if (readiness.status !== "PASS") throw new Error("STAGING_ACCEPTANCE_READINESS_FAILED");
  await assertBootstrapPrerequisites(process.env);
  const namespace = acceptanceNamespace(marker);
  const database = createDatabaseClient(required("DIRECT_URL"));
  try {
    await assertNoAcceptanceBusinessHistory(
      database,
      required("STAGING_TEST_TEACHER_CLERK_ID"),
      namespace.activityTitle,
    );
    const probe = await probeAcceptanceNamespace(database, namespace.classroomId, namespace.classroomName, required("STAGING_TEST_TEACHER_CLERK_ID"), required("STAGING_TEST_STUDENT_CLERK_ID"), required("STAGING_TEST_OTHER_STUDENT_CLERK_ID"));
    if (probe === "COLLISION") throw new Error("STAGING_ACCEPTANCE_NAMESPACE_COLLISION");
    const result = await bootstrapClerkClassroom(database, {
      teacherAuthSubject: required("STAGING_TEST_TEACHER_CLERK_ID"),
      teacherDisplayName: acceptanceTeacherDisplayName,
      studentAuthSubject: required("STAGING_TEST_STUDENT_CLERK_ID"),
      studentDisplayName: acceptanceStudentDisplayName,
      studentRosterKey: acceptanceStudentRosterKey,
      classroomId: namespace.classroomId,
      classroomName: namespace.classroomName,
    });
    const otherStudent = await bootstrapAdditionalClerkClassroomStudent(database, {
      teacherAuthSubject: required("STAGING_TEST_TEACHER_CLERK_ID"),
      classroomId: namespace.classroomId,
      classroomName: namespace.classroomName,
      additionalStudentAuthSubject: required("STAGING_TEST_OTHER_STUDENT_CLERK_ID"),
      additionalStudentDisplayName: acceptanceOtherStudentDisplayName,
      additionalStudentRosterKey: acceptanceOtherStudentRosterKey,
    });
    const otherTeacher = await bootstrapStandaloneClerkTeacher(database, {
      teacherAuthSubject: required("STAGING_TEST_OTHER_TEACHER_CLERK_ID"),
      teacherDisplayName: acceptanceOtherTeacherDisplayName,
    });
    await writeAcceptanceArtifact(marker, "bootstrap.json", {
      schema: "staging-synthetic-acceptance-bootstrap.v1",
      status: "PASS",
      namespace: { marker, classroomDerived: true },
      collisionProbe: probe,
      resources: {
        teacher: result.teacher.status,
        student: result.student.status,
        otherStudent: otherStudent.additionalStudent.status,
        otherTeacher: otherTeacher.teacher.status,
        classroom: result.classroom.status,
        membership: result.membership.status,
        otherMembership: otherStudent.membership.status,
      },
      realStudentDataAllowed: false,
      productionDecision: "NO_GO",
    });
    process.stdout.write('{"schema":"staging-synthetic-acceptance-bootstrap.v1","status":"PASS"}\n');
  } finally { await database.$disconnect(); }
}

void main().catch(async (error: unknown) => {
  const marker = process.env.STAGING_RUN_MARKER?.trim() ?? "";
  try { await writeAcceptanceArtifact(marker, "bootstrap.json", { schema: "staging-synthetic-acceptance-bootstrap.v1", status: "FAIL", checks: [{ code: stableAcceptanceErrorCode(error), status: "FAIL" }], realStudentDataAllowed: false, productionDecision: "NO_GO" }); } catch { /* output path must not be weakened */ }
  process.stdout.write(`{"schema":"staging-synthetic-acceptance-bootstrap.v1","status":"FAIL","code":"${stableAcceptanceErrorCode(error)}"}\n`);
  process.exitCode = 1;
});
