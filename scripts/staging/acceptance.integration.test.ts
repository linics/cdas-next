import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { legacySchoolId } from "../../src/domain/school/legacy-school";
import {
  bootstrapClerkClassroom,
  bootstrapAdditionalClerkClassroomStudent,
  bootstrapStandaloneClerkTeacher,
  BootstrapClerkClassroomError,
} from "../../src/server/bootstrap/bootstrap-clerk-classroom";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  acceptanceNamespace,
  acceptanceOtherStudentDisplayName,
  acceptanceOtherTeacherDisplayName,
  acceptanceStudentDisplayName,
  acceptanceTeacherDisplayName,
} from "./acceptance/contracts";
import { assertNoAcceptanceBusinessHistory } from "./acceptance/fixture";
import { probeAcceptanceNamespace } from "./acceptance/fixture";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

function fixture() {
  const marker = `cdas-staging-${randomUUID().replaceAll("-", "")}`;
  const namespace = acceptanceNamespace(marker);
  const suffix = randomUUID().replaceAll("-", "");
  return {
    namespace,
    input: {
      teacherAuthSubject: `user_stagingteacher${suffix}`,
      teacherDisplayName: acceptanceTeacherDisplayName,
      studentAuthSubject: `user_stagingstudent${suffix}`,
      studentDisplayName: acceptanceStudentDisplayName,
      otherStudentAuthSubject: `user_stagingother${suffix}`,
      otherStudentDisplayName: acceptanceOtherStudentDisplayName,
      otherTeacherAuthSubject: `user_stagingotherteacher${suffix}`,
      otherTeacherDisplayName: acceptanceOtherTeacherDisplayName,
      classroomId: namespace.classroomId,
      classroomName: namespace.classroomName,
    },
  };
}

function primaryInput(input: ReturnType<typeof fixture>["input"]) {
  return {
    teacherAuthSubject: input.teacherAuthSubject,
    teacherDisplayName: input.teacherDisplayName,
    studentAuthSubject: input.studentAuthSubject,
    studentDisplayName: input.studentDisplayName,
    classroomId: input.classroomId,
    classroomName: input.classroomName,
  };
}

describeWithDatabase("staging synthetic acceptance bootstrap", () => {
  afterAll(async () => database?.$disconnect());

  it("only appends a namespace and safely re-enters the exact same fixture", async () => {
    const { input } = fixture();
    await expect(
      probeAcceptanceNamespace(
        database!,
        input.classroomId,
        input.classroomName,
        input.teacherAuthSubject,
        input.studentAuthSubject,
        input.otherStudentAuthSubject,
      ),
    ).resolves.toBe("ABSENT");
    const first = await bootstrapClerkClassroom(database!, primaryInput(input));
    const repeated = await bootstrapClerkClassroom(database!, primaryInput(input));
    expect(first.classroom.status).toBe("CREATED");
    expect(repeated).toEqual({
      ...first,
      teacher: { ...first.teacher, status: "EXISTING" },
      student: { ...first.student, status: "EXISTING" },
      classroom: { ...first.classroom, status: "EXISTING" },
      membership: { ...first.membership, status: "EXISTING" },
    });
    const other = await bootstrapAdditionalClerkClassroomStudent(database!, {
      teacherAuthSubject: input.teacherAuthSubject,
      classroomId: input.classroomId,
      classroomName: input.classroomName,
      additionalStudentAuthSubject: input.otherStudentAuthSubject,
      additionalStudentDisplayName: input.otherStudentDisplayName,
    });
    const repeatedOther = await bootstrapAdditionalClerkClassroomStudent(database!, {
      teacherAuthSubject: input.teacherAuthSubject,
      classroomId: input.classroomId,
      classroomName: input.classroomName,
      additionalStudentAuthSubject: input.otherStudentAuthSubject,
      additionalStudentDisplayName: input.otherStudentDisplayName,
    });
    expect(other.additionalStudent.status).toBe("CREATED");
    expect(repeatedOther).toEqual({
      additionalStudent: { ...other.additionalStudent, status: "EXISTING" },
      membership: { ...other.membership, status: "EXISTING" },
    });
    const otherTeacher = await bootstrapStandaloneClerkTeacher(database!, {
      teacherAuthSubject: input.otherTeacherAuthSubject,
      teacherDisplayName: input.otherTeacherDisplayName,
    });
    expect(otherTeacher.teacher.status).toBe("CREATED");
    await expect(database!.classroom.count({
      where: { managerId: otherTeacher.teacher.id },
    })).resolves.toBe(0);
    await expect(database!.classroomMembership.count({
      where: { studentId: otherTeacher.teacher.id },
    })).resolves.toBe(0);
    await expect(database!.classroomMembership.count({ where: { classroomId: input.classroomId } })).resolves.toBe(2);
    await expect(
      probeAcceptanceNamespace(
        database!,
        input.classroomId,
        input.classroomName,
        input.teacherAuthSubject,
        input.studentAuthSubject,
        input.otherStudentAuthSubject,
      ),
    ).resolves.toBe("MATCHING");
  });

  it("fails closed on a derived namespace collision without reassigning it", async () => {
    const { input } = fixture();
    const foreign = await database!.appUser.create({
      data: {
        authSubject: `user_stagingforeign${randomUUID().replaceAll("-", "")}`,
        displayName: "Foreign staging manager",
        role: "TEACHER",
        schoolId: legacySchoolId,
        legacyProfile: true,
      },
    });
    await database!.classroom.create({
      data: {
        id: input.classroomId,
        name: input.classroomName,
        managerId: foreign.id,
        schoolId: legacySchoolId,
      },
    });
    await expect(bootstrapClerkClassroom(database!, primaryInput(input))).rejects.toEqual(new BootstrapClerkClassroomError("CLASSROOM_MANAGER_CONFLICT", "classroom"));
    await expect(database!.classroom.findUniqueOrThrow({ where: { id: input.classroomId }, select: { managerId: true } })).resolves.toEqual({ managerId: foreign.id });
  });

  it("rejects a same-marker retry after any browser business history exists", async () => {
    const { input, namespace } = fixture();
    const bootstrapped = await bootstrapClerkClassroom(database!, primaryInput(input));
    await database!.activityDraft.create({
      data: {
        ownerId: bootstrapped.teacher.id,
        status: "EDITING",
        version: 1,
        title: namespace.activityTitle,
        summary: namespace.activitySummary,
        taskInstructions: "Synthetic retry guard fixture",
        revisions: {
          create: {
            version: 1,
            source: "MANUAL",
            title: namespace.activityTitle,
            summary: namespace.activitySummary,
            taskInstructions: "Synthetic retry guard fixture",
          },
        },
      },
    });

    await expect(
      assertNoAcceptanceBusinessHistory(
        database!,
        input.teacherAuthSubject,
        namespace.activityTitle,
      ),
    ).rejects.toThrow("STAGING_ACCEPTANCE_BUSINESS_HISTORY_ALREADY_EXISTS");
  });
});
