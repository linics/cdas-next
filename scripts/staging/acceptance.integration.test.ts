import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import {
  bootstrapClerkClassroom,
  BootstrapClerkClassroomError,
} from "../../src/server/bootstrap/bootstrap-clerk-classroom";
import { createDatabaseClient } from "../../src/server/db/client";
import {
  acceptanceNamespace,
  acceptanceStudentDisplayName,
  acceptanceTeacherDisplayName,
} from "./acceptance/contracts";
import { assertNoAcceptanceBusinessHistory } from "./acceptance/fixture";

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
      classroomId: namespace.classroomId,
      classroomName: namespace.classroomName,
    },
  };
}

describeWithDatabase("staging synthetic acceptance bootstrap", () => {
  afterAll(async () => database?.$disconnect());

  it("only appends a namespace and safely re-enters the exact same fixture", async () => {
    const { input } = fixture();
    const first = await bootstrapClerkClassroom(database!, input);
    const repeated = await bootstrapClerkClassroom(database!, input);
    expect(first.classroom.status).toBe("CREATED");
    expect(repeated).toEqual({
      ...first,
      teacher: { ...first.teacher, status: "EXISTING" },
      student: { ...first.student, status: "EXISTING" },
      classroom: { ...first.classroom, status: "EXISTING" },
      membership: { ...first.membership, status: "EXISTING" },
    });
    await expect(database!.classroomMembership.count({ where: { classroomId: input.classroomId } })).resolves.toBe(1);
  });

  it("fails closed on a derived namespace collision without reassigning it", async () => {
    const { input } = fixture();
    const foreign = await database!.appUser.create({ data: { authSubject: `user_stagingforeign${randomUUID().replaceAll("-", "")}`, displayName: "Foreign staging manager", role: "TEACHER" } });
    await database!.classroom.create({ data: { id: input.classroomId, name: input.classroomName, managerId: foreign.id } });
    await expect(bootstrapClerkClassroom(database!, input)).rejects.toEqual(new BootstrapClerkClassroomError("CLASSROOM_MANAGER_CONFLICT", "classroom"));
    await expect(database!.classroom.findUniqueOrThrow({ where: { id: input.classroomId }, select: { managerId: true } })).resolves.toEqual({ managerId: foreign.id });
  });

  it("rejects a same-marker retry after any browser business history exists", async () => {
    const { input, namespace } = fixture();
    const bootstrapped = await bootstrapClerkClassroom(database!, input);
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
