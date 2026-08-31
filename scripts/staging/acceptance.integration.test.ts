import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  bootstrapLocalStaging,
  stagingLocalIdentifier,
} from "../../src/server/bootstrap/bootstrap-local-staging";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  acceptanceNamespace,
  acceptanceOtherStudentDisplayName,
  acceptanceOtherTeacherDisplayName,
  acceptanceStudentDisplayName,
  acceptanceTeacherDisplayName,
} from "./acceptance/contracts";
import {
  assertNoAcceptanceBusinessHistory,
  probeAcceptanceNamespace,
} from "./acceptance/fixture";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const primarySchoolCode = "SCHTST23";
const secondarySchoolCode = "SCHTST45";
const password = "Cdas-acceptance-test9a";

function fixture() {
  const marker = `cdas-staging-${randomUUID().replaceAll("-", "")}`;
  const namespace = acceptanceNamespace(marker);
  const suffix = randomUUID().replaceAll("-", "");
  const teacherStaffNo = `T-${suffix.slice(0, 12)}`.toUpperCase();
  const otherTeacherStaffNo = `O-${suffix.slice(12, 24)}`.toUpperCase();
  const studentNo = suffix.replaceAll(/[a-f]/gu, "7").slice(0, 12);
  const otherStudentNo = suffix.replaceAll(/[a-f]/gu, "8").slice(12, 24);
  const teacherIdentifier = stagingLocalIdentifier({
    schoolCode: primarySchoolCode,
    role: "TEACHER",
    staffNo: teacherStaffNo,
  });
  const studentIdentifier = stagingLocalIdentifier({
    schoolCode: primarySchoolCode,
    role: "STUDENT",
    studentNo,
  });
  const otherStudentIdentifier = stagingLocalIdentifier({
    schoolCode: primarySchoolCode,
    role: "STUDENT",
    studentNo: otherStudentNo,
  });
  const otherTeacherIdentifier = stagingLocalIdentifier({
    schoolCode: secondarySchoolCode,
    role: "TEACHER",
    staffNo: otherTeacherStaffNo,
  });
  return {
    namespace,
    teacherIdentifier,
    studentIdentifier,
    otherStudentIdentifier,
    input: {
      schools: [
        {
          code: primarySchoolCode,
          name: "CDAS Acceptance Test School A",
          status: "ACTIVE" as const,
        },
        {
          code: secondarySchoolCode,
          name: "CDAS Acceptance Test School B",
          status: "ACTIVE" as const,
        },
      ],
      identities: [
        {
          schoolCode: primarySchoolCode,
          identifier: teacherIdentifier,
          password,
          displayName: acceptanceTeacherDisplayName,
          role: "TEACHER" as const,
          staffNo: teacherStaffNo,
        },
        {
          schoolCode: primarySchoolCode,
          identifier: studentIdentifier,
          password,
          displayName: acceptanceStudentDisplayName,
          role: "STUDENT" as const,
          studentNo,
        },
        {
          schoolCode: primarySchoolCode,
          identifier: otherStudentIdentifier,
          password,
          displayName: acceptanceOtherStudentDisplayName,
          role: "STUDENT" as const,
          studentNo: otherStudentNo,
        },
        {
          schoolCode: secondarySchoolCode,
          identifier: otherTeacherIdentifier,
          password,
          displayName: acceptanceOtherTeacherDisplayName,
          role: "TEACHER" as const,
          staffNo: otherTeacherStaffNo,
        },
      ],
      classroom: {
        id: namespace.classroomId,
        name: namespace.classroomName,
        teacherIdentifier,
        studentIdentifiers: [studentIdentifier, otherStudentIdentifier],
      },
    },
  };
}

describeWithDatabase("staging synthetic acceptance bootstrap", () => {
  afterAll(async () => database?.$disconnect());

  it("only appends a namespace and safely re-enters the exact same fixture", async () => {
    const current = fixture();
    await expect(probeAcceptanceNamespace(
      database!,
      current.namespace.classroomId,
      current.namespace.classroomName,
      current.teacherIdentifier,
      current.studentIdentifier,
      current.otherStudentIdentifier,
    )).resolves.toBe("ABSENT");

    const first = await bootstrapLocalStaging(database!, current.input);
    const repeated = await bootstrapLocalStaging(database!, current.input);
    expect(first.classroom).toBe("CREATED");
    expect(first.memberships).toBe(2);
    expect(repeated.classroom).toBe("EXISTING");
    expect(repeated.memberships).toBe(0);
    expect(Object.values(repeated.identities)).toEqual([
      "EXISTING",
      "EXISTING",
      "EXISTING",
      "EXISTING",
    ]);
    await expect(probeAcceptanceNamespace(
      database!,
      current.namespace.classroomId,
      current.namespace.classroomName,
      current.teacherIdentifier,
      current.studentIdentifier,
      current.otherStudentIdentifier,
    )).resolves.toBe("MATCHING");
  });

  it("fails closed on a derived namespace collision without reassigning it", async () => {
    const current = fixture();
    const school = await database!.school.upsert({
      where: { code: primarySchoolCode },
      create: {
        code: primarySchoolCode,
        name: "CDAS Acceptance Test School A",
        status: "ACTIVE",
        teacherInviteCodeHash: "a".repeat(64),
      },
      update: {},
    });
    const foreignId = randomUUID();
    const foreign = await database!.appUser.create({
      data: {
        id: foreignId,
        authSubject: `local:${foreignId}`,
        displayName: "Foreign staging manager",
        role: "TEACHER",
        schoolId: school.id,
        staffNo: `F-${randomUUID().slice(0, 8)}`.toUpperCase(),
      },
    });
    await database!.classroom.create({
      data: {
        id: current.namespace.classroomId,
        name: current.namespace.classroomName,
        managerId: foreign.id,
        schoolId: school.id,
      },
    });
    await expect(bootstrapLocalStaging(database!, current.input)).rejects.toThrow(
      "CLASSROOM_MANAGER_CONFLICT",
    );
    await expect(database!.classroom.findUniqueOrThrow({
      where: { id: current.namespace.classroomId },
      select: { managerId: true },
    })).resolves.toEqual({ managerId: foreign.id });
  });

  it("rejects a same-marker retry after any browser business history exists", async () => {
    const current = fixture();
    await bootstrapLocalStaging(database!, current.input);
    const teacher = await database!.localCredential.findUniqueOrThrow({
      where: { identifier: current.teacherIdentifier },
      select: { userId: true },
    });
    await database!.activityDraft.create({
      data: {
        ownerId: teacher.userId,
        status: "EDITING",
        version: 1,
        title: current.namespace.activityTitle,
        summary: current.namespace.activitySummary,
        taskInstructions: "Synthetic retry guard fixture",
        revisions: {
          create: {
            version: 1,
            source: "MANUAL",
            title: current.namespace.activityTitle,
            summary: current.namespace.activitySummary,
            taskInstructions: "Synthetic retry guard fixture",
          },
        },
      },
    });
    await expect(assertNoAcceptanceBusinessHistory(
      database!,
      current.teacherIdentifier,
      current.namespace.activityTitle,
    )).rejects.toThrow("STAGING_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS");
  });
});
