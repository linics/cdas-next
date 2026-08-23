import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../db/client";
import {
  bootstrapClerkClassroom,
  bootstrapAdditionalClerkClassroomStudent,
  BootstrapClerkClassroomError,
  type BootstrapClerkClassroomInput,
} from "./bootstrap-clerk-classroom";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

function bootstrapInput(
  overrides: Partial<BootstrapClerkClassroomInput> = {},
): BootstrapClerkClassroomInput {
  const suffix = randomUUID().replaceAll("-", "");
  return {
    teacherAuthSubject: `user_teacher${suffix}`,
    teacherDisplayName: "Bootstrap Teacher",
    studentAuthSubject: `user_student${suffix}`,
    studentDisplayName: "Bootstrap Student",
    classroomId: randomUUID(),
    classroomName: "Bootstrap Classroom",
    ...overrides,
  };
}

const firstRunAt = new Date("2026-08-18T12:00:00.000Z");

describeWithDatabase("Clerk classroom bootstrap", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("creates one complete mapping and returns the same resources on retry", async () => {
    const input = bootstrapInput();

    const first = await bootstrapClerkClassroom(
      database!,
      input,
      () => firstRunAt,
    );
    const repeated = await bootstrapClerkClassroom(
      database!,
      input,
      () => new Date("2026-08-18T13:00:00.000Z"),
    );

    expect(first.teacher.status).toBe("CREATED");
    expect(first.student.status).toBe("CREATED");
    expect(first.classroom.status).toBe("CREATED");
    expect(first.membership.status).toBe("CREATED");
    expect(repeated).toEqual({
      ...first,
      teacher: { ...first.teacher, status: "EXISTING" },
      student: { ...first.student, status: "EXISTING" },
      classroom: { ...first.classroom, status: "EXISTING" },
      membership: { ...first.membership, status: "EXISTING" },
    });
    const publicResult = JSON.stringify(first);
    expect(publicResult).not.toContain(input.teacherAuthSubject);
    expect(publicResult).not.toContain(input.studentAuthSubject);
    expect(publicResult).not.toContain("requestFingerprint");
    await expect(
      database!.appUser.count({
        where: {
          authSubject: {
            in: [input.teacherAuthSubject, input.studentAuthSubject],
          },
        },
      }),
    ).resolves.toBe(2);
    await expect(
      database!.classroomMembership.count({
        where: {
          classroomId: input.classroomId,
          studentId: first.student.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("is idempotent when the same input runs concurrently", async () => {
    const input = bootstrapInput();

    const [left, right] = await Promise.all([
      bootstrapClerkClassroom(database!, input, () => firstRunAt),
      bootstrapClerkClassroom(database!, input, () => firstRunAt),
    ]);

    expect(left.teacher.id).toBe(right.teacher.id);
    expect(left.student.id).toBe(right.student.id);
    expect(left.classroom.id).toBe(right.classroom.id);
    expect(left.membership.id).toBe(right.membership.id);
    expect([left.membership.status, right.membership.status].sort()).toEqual([
      "CREATED",
      "EXISTING",
    ]);
  });

  it("fails clearly without changing an existing user's role or profile", async () => {
    const input = bootstrapInput();
    await database!.appUser.create({
      data: {
        authSubject: input.teacherAuthSubject,
        role: "STUDENT",
        displayName: input.teacherDisplayName,
      },
    });

    await expect(
      bootstrapClerkClassroom(database!, input, () => firstRunAt),
    ).rejects.toEqual(
      new BootstrapClerkClassroomError(
        "USER_ROLE_CONFLICT",
        "teacher",
      ),
    );
    await expect(
      database!.appUser.findUniqueOrThrow({
        where: { authSubject: input.teacherAuthSubject },
        select: { role: true, displayName: true },
      }),
    ).resolves.toEqual({
      role: "STUDENT",
      displayName: input.teacherDisplayName,
    });
    await expect(
      database!.appUser.findUnique({
        where: { authSubject: input.studentAuthSubject },
      }),
    ).resolves.toBeNull();
  });

  it("fails atomically instead of silently changing a display name", async () => {
    const input = bootstrapInput();
    await database!.appUser.create({
      data: {
        authSubject: input.teacherAuthSubject,
        role: "TEACHER",
        displayName: "Existing Teacher Name",
      },
    });

    await expect(
      bootstrapClerkClassroom(database!, input, () => firstRunAt),
    ).rejects.toEqual(
      new BootstrapClerkClassroomError(
        "USER_PROFILE_CONFLICT",
        "teacher",
      ),
    );
    await expect(
      database!.appUser.findUniqueOrThrow({
        where: { authSubject: input.teacherAuthSubject },
        select: { displayName: true },
      }),
    ).resolves.toEqual({ displayName: "Existing Teacher Name" });
    await expect(
      database!.appUser.findUnique({
        where: { authSubject: input.studentAuthSubject },
      }),
    ).resolves.toBeNull();
  });

  it("fails atomically instead of reassigning an existing classroom", async () => {
    const input = bootstrapInput();
    const existingManager = await database!.appUser.create({
      data: {
        authSubject: `user_manager${randomUUID().replaceAll("-", "")}`,
        role: "TEACHER",
        displayName: "Existing Manager",
      },
    });
    await database!.classroom.create({
      data: {
        id: input.classroomId,
        name: input.classroomName,
        managerId: existingManager.id,
      },
    });

    await expect(
      bootstrapClerkClassroom(database!, input, () => firstRunAt),
    ).rejects.toEqual(
      new BootstrapClerkClassroomError(
        "CLASSROOM_MANAGER_CONFLICT",
        "classroom",
      ),
    );
    await expect(
      database!.classroom.findUniqueOrThrow({
        where: { id: input.classroomId },
        select: { managerId: true },
      }),
    ).resolves.toEqual({ managerId: existingManager.id });
    await expect(
      database!.appUser.count({
        where: {
          authSubject: {
            in: [input.teacherAuthSubject, input.studentAuthSubject],
          },
        },
      }),
    ).resolves.toBe(0);
  });

  it("fails atomically instead of silently renaming a classroom", async () => {
    const input = bootstrapInput();
    const first = await bootstrapClerkClassroom(
      database!,
      input,
      () => firstRunAt,
    );

    await expect(
      bootstrapClerkClassroom(
        database!,
        { ...input, classroomName: "A Different Name" },
        () => new Date("2026-08-18T13:00:00.000Z"),
      ),
    ).rejects.toEqual(
      new BootstrapClerkClassroomError(
        "CLASSROOM_NAME_CONFLICT",
        "classroom",
      ),
    );
    await expect(
      database!.classroom.findUniqueOrThrow({
        where: { id: input.classroomId },
        select: { name: true },
      }),
    ).resolves.toEqual({ name: input.classroomName });
    await expect(
      database!.classroomMembership.count({
        where: { id: first.membership.id },
      }),
    ).resolves.toBe(1);
  });

  it("appends a new current interval after membership history ended", async () => {
    const input = bootstrapInput();
    const first = await bootstrapClerkClassroom(
      database!,
      input,
      () => firstRunAt,
    );
    await database!.classroomMembership.update({
      where: { id: first.membership.id },
      data: { endedAt: new Date("2026-08-18T13:00:00.000Z") },
    });

    const rejoined = await bootstrapClerkClassroom(
      database!,
      input,
      () => new Date("2026-08-18T14:00:00.000Z"),
    );

    expect(rejoined.membership.status).toBe("CREATED");
    expect(rejoined.membership.id).not.toBe(first.membership.id);
    await expect(
      database!.classroomMembership.count({
        where: {
          classroomId: input.classroomId,
          studentId: first.student.id,
        },
      }),
    ).resolves.toBe(2);
  });

  it("adds an additional student without changing the primary mapping or history", async () => {
    const input = bootstrapInput();
    const primary = await bootstrapClerkClassroom(database!, input, () => firstRunAt);
    const otherSubject = `user_other${randomUUID().replaceAll("-", "")}`;
    const result = await bootstrapAdditionalClerkClassroomStudent(database!, {
      teacherAuthSubject: input.teacherAuthSubject,
      classroomId: input.classroomId,
      classroomName: input.classroomName,
      additionalStudentAuthSubject: otherSubject,
      additionalStudentDisplayName: "Other Student",
    }, () => firstRunAt);
    expect(result.additionalStudent.status).toBe("CREATED");
    await expect(database!.classroomMembership.count({ where: { classroomId: input.classroomId } })).resolves.toBe(2);
    await expect(database!.classroomMembership.count({ where: { id: primary.membership.id } })).resolves.toBe(1);
  });

  it("is concurrent-idempotent and fails closed for additional-student conflicts", async () => {
    const input = bootstrapInput();
    await bootstrapClerkClassroom(database!, input, () => firstRunAt);
    const otherSubject = `user_other${randomUUID().replaceAll("-", "")}`;
    const additional = {
      teacherAuthSubject: input.teacherAuthSubject,
      classroomId: input.classroomId,
      classroomName: input.classroomName,
      additionalStudentAuthSubject: otherSubject,
      additionalStudentDisplayName: "Other Student",
    };
    const [left, right] = await Promise.all([
      bootstrapAdditionalClerkClassroomStudent(database!, additional, () => firstRunAt),
      bootstrapAdditionalClerkClassroomStudent(database!, additional, () => firstRunAt),
    ]);
    expect([left.membership.status, right.membership.status].sort()).toEqual(["CREATED", "EXISTING"]);
    await expect(bootstrapAdditionalClerkClassroomStudent(database!, { ...additional, additionalStudentDisplayName: "Changed" }, () => firstRunAt)).rejects.toEqual(new BootstrapClerkClassroomError("USER_PROFILE_CONFLICT", "student"));
    await expect(bootstrapAdditionalClerkClassroomStudent(database!, { ...additional, classroomName: "Changed" }, () => firstRunAt)).rejects.toEqual(new BootstrapClerkClassroomError("CLASSROOM_NAME_CONFLICT", "classroom"));
  });

  it("fails closed for additional-student role, manager, and future-interval conflicts", async () => {
    const input = bootstrapInput();
    const primary = await bootstrapClerkClassroom(database!, input, () => firstRunAt);
    const roleSubject = `user_otherrole${randomUUID().replaceAll("-", "")}`;
    await database!.appUser.create({
      data: { authSubject: roleSubject, displayName: "Other", role: "TEACHER" },
    });
    const base = {
      teacherAuthSubject: input.teacherAuthSubject,
      classroomId: input.classroomId,
      classroomName: input.classroomName,
      additionalStudentDisplayName: "Other Student",
    };
    await expect(
      bootstrapAdditionalClerkClassroomStudent(database!, {
        ...base,
        additionalStudentAuthSubject: roleSubject,
      }, () => firstRunAt),
    ).rejects.toEqual(new BootstrapClerkClassroomError("USER_ROLE_CONFLICT", "student"));

    const foreign = await database!.appUser.create({
      data: { authSubject: `user_othermanager${randomUUID().replaceAll("-", "")}`, displayName: "Foreign", role: "TEACHER" },
    });
    const foreignClassroomId = randomUUID();
    await database!.classroom.create({
      data: { id: foreignClassroomId, name: input.classroomName, managerId: foreign.id },
    });
    await expect(
      bootstrapAdditionalClerkClassroomStudent(database!, {
        ...base,
        classroomId: foreignClassroomId,
        additionalStudentAuthSubject: `user_othermanagerstudent${randomUUID().replaceAll("-", "")}`,
      }, () => firstRunAt),
    ).rejects.toEqual(new BootstrapClerkClassroomError("CLASSROOM_MANAGER_CONFLICT", "classroom"));

    const futureSubject = `user_otherfuture${randomUUID().replaceAll("-", "")}`;
    const futureStudent = await database!.appUser.create({
      data: { authSubject: futureSubject, displayName: "Future", role: "STUDENT" },
    });
    await database!.classroomMembership.create({
      data: { classroomId: input.classroomId, studentId: futureStudent.id, joinedAt: new Date("2026-08-18T13:00:00.000Z") },
    });
    await expect(
      bootstrapAdditionalClerkClassroomStudent(database!, {
        ...base,
        additionalStudentAuthSubject: futureSubject,
        additionalStudentDisplayName: "Future",
      }, () => firstRunAt),
    ).rejects.toEqual(new BootstrapClerkClassroomError("MEMBERSHIP_INTERVAL_CONFLICT", "membership"));
    await expect(database!.classroomMembership.count({ where: { id: primary.membership.id } })).resolves.toBe(1);
  });
});
