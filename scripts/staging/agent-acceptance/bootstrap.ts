import nextEnvironment from "@next/env";

import {
  bootstrapLocalStaging,
  stagingLocalIdentifier,
} from "../../../src/server/bootstrap/bootstrap-local-staging";
import { createDatabaseClient } from "../../../src/server/db/client";
import {
  agentAcceptanceNamespace,
  agentAcceptanceOtherStudentDisplayName,
  agentAcceptanceOtherTeacherDisplayName,
  agentAcceptanceStudentDisplayName,
  agentAcceptanceTeacherDisplayName,
  stableAgentAcceptanceError,
} from "./contracts";
import {
  assertNoAgentBusinessHistory,
  probeAgentNamespace,
} from "./fixture";
import { writeAgentArtifact } from "./output";
import { assertAgentBootstrapPrerequisites } from "./prerequisites";

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
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
  await assertAgentBootstrapPrerequisites(process.env);
  const namespace = agentAcceptanceNamespace(marker);
  const primary = required("STAGING_TEST_PRIMARY_SCHOOL_CODE");
  const secondary = required("STAGING_TEST_SECONDARY_SCHOOL_CODE");
  const disabledSchool = required("STAGING_TEST_DISABLED_SCHOOL_CODE");
  const teacherIdentifier = stagingLocalIdentifier({
    schoolCode: primary,
    role: "TEACHER",
    staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
  });
  const studentIdentifier = stagingLocalIdentifier({
    schoolCode: primary,
    role: "STUDENT",
    studentNo: required("STAGING_TEST_STUDENT_NO"),
  });
  const otherStudentIdentifier = stagingLocalIdentifier({
    schoolCode: primary,
    role: "STUDENT",
    studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
  });
  const otherTeacherIdentifier = stagingLocalIdentifier({
    schoolCode: secondary,
    role: "TEACHER",
    staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
  });
  const identities: StagingIdentity[] = [
    {
      schoolCode: primary,
      identifier: teacherIdentifier,
      password: required("STAGING_TEST_TEACHER_PASSWORD"),
      displayName: agentAcceptanceTeacherDisplayName,
      role: "TEACHER",
      staffNo: required("STAGING_TEST_TEACHER_STAFF_NO"),
    },
    {
      schoolCode: primary,
      identifier: studentIdentifier,
      password: required("STAGING_TEST_STUDENT_PASSWORD"),
      displayName: agentAcceptanceStudentDisplayName,
      role: "STUDENT",
      studentNo: required("STAGING_TEST_STUDENT_NO"),
    },
    {
      schoolCode: primary,
      identifier: otherStudentIdentifier,
      password: required("STAGING_TEST_OTHER_STUDENT_PASSWORD"),
      displayName: agentAcceptanceOtherStudentDisplayName,
      role: "STUDENT",
      studentNo: required("STAGING_TEST_OTHER_STUDENT_NO"),
    },
    {
      schoolCode: secondary,
      identifier: otherTeacherIdentifier,
      password: required("STAGING_TEST_OTHER_TEACHER_PASSWORD"),
      displayName: agentAcceptanceOtherTeacherDisplayName,
      role: "TEACHER",
      staffNo: required("STAGING_TEST_OTHER_TEACHER_STAFF_NO"),
    },
    {
      schoolCode: primary,
      identifier: stagingLocalIdentifier({
        schoolCode: primary,
        role: "STUDENT",
        studentNo: required("STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO"),
      }),
      password: required("STAGING_TEST_DISABLED_ACCOUNT_PASSWORD"),
      displayName: "CDAS Staging Synthetic Disabled Account",
      role: "STUDENT",
      studentNo: required("STAGING_TEST_DISABLED_ACCOUNT_STUDENT_NO"),
      accountStatus: "DISABLED",
    },
    {
      schoolCode: disabledSchool,
      identifier: stagingLocalIdentifier({
        schoolCode: disabledSchool,
        role: "TEACHER",
        staffNo: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO"),
      }),
      password: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_PASSWORD"),
      displayName: "CDAS Staging Synthetic Disabled School Teacher",
      role: "TEACHER",
      staffNo: required("STAGING_TEST_DISABLED_SCHOOL_TEACHER_STAFF_NO"),
    },
  ];
  const database = createDatabaseClient(required("DIRECT_URL"));
  try {
    await assertNoAgentBusinessHistory(database, teacherIdentifier, namespace.activityTitle);
    const probe = await probeAgentNamespace(
      database,
      namespace.classroomId,
      namespace.classroomName,
      teacherIdentifier,
      studentIdentifier,
      otherStudentIdentifier,
    );
    if (probe === "COLLISION") {
      throw new Error("STAGING_AGENT_ACCEPTANCE_NAMESPACE_COLLISION");
    }
    const result = await bootstrapLocalStaging(database, {
      schools: [
        { code: primary, name: "CDAS Staging Synthetic School A", status: "ACTIVE" },
        { code: secondary, name: "CDAS Staging Synthetic School B", status: "ACTIVE" },
        { code: disabledSchool, name: "CDAS Staging Synthetic School C", status: "DISABLED" },
      ],
      identities,
      classroom: {
        id: namespace.classroomId,
        name: namespace.classroomName,
        teacherIdentifier,
        studentIdentifiers: [studentIdentifier, otherStudentIdentifier],
      },
    });
    await writeAgentArtifact(marker, "bootstrap.json", {
      schema: "staging-agent-acceptance-bootstrap.v1",
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
    process.stdout.write(
      '{"schema":"staging-agent-acceptance-bootstrap.v1","status":"PASS"}\n',
    );
  } finally {
    for (const identity of identities) identity.password = "";
    await database.$disconnect();
  }
}

void main().catch(async (error: unknown) => {
  try {
    await writeAgentArtifact(
      process.env.STAGING_RUN_MARKER?.trim() ?? "",
      "bootstrap.json",
      {
        schema: "staging-agent-acceptance-bootstrap.v1",
        status: "FAIL",
        checks: [{ code: stableAgentAcceptanceError(error), status: "FAIL" }],
        realStudentDataAllowed: false,
        productionDecision: "NO_GO",
      },
    );
  } catch {
    // The safe output path is intentionally fail-closed.
  }
  process.stdout.write(
    '{"schema":"staging-agent-acceptance-bootstrap.v1","status":"FAIL"}\n',
  );
  process.exitCode = 1;
});
