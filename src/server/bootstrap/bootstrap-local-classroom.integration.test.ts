import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { legacySchoolId } from "../../domain/school/legacy-school";
import {
  hashPassword,
  hashSessionToken,
  teacherIdentifier,
  verifyPassword,
} from "../auth/local-auth-primitives";
import { createDatabaseClient } from "../db/client";
import {
  bootstrapLocalClassroom,
  BootstrapLocalClassroomError,
  type BootstrapLocalClassroomInput,
} from "./bootstrap-local-classroom";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const firstRunAt = new Date("2026-09-01T12:00:00.000Z");

function bootstrapInput(): BootstrapLocalClassroomInput {
  const suffix = randomUUID().replaceAll("-", "");
  return {
    teacherStaffNo: `T-${suffix.slice(0, 10)}`,
    teacherPassword: `Teacher-${suffix.slice(0, 18)}!`,
    studentNo: String(randomInt(100000, 999999)),
    studentPassword: `Student-${suffix.slice(0, 18)}!`,
    teacherDisplayName: "Local Bootstrap Teacher",
    studentDisplayName: "Local Bootstrap Student",
    classroomId: randomUUID(),
    classroomName: "Local Bootstrap Classroom",
  };
}

describeWithDatabase("local classroom bootstrap", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("creates one complete mapping and repeats it without duplicates", async () => {
    const input = bootstrapInput();
    const first = await bootstrapLocalClassroom(database!, input, () => firstRunAt);
    const repeated = await bootstrapLocalClassroom(
      database!,
      input,
      () => new Date("2026-09-01T13:00:00.000Z"),
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
    await expect(
      database!.appUser.findUniqueOrThrow({
        where: { id: first.teacher.id },
        select: { authSubject: true, schoolId: true, staffNo: true },
      }),
    ).resolves.toEqual({
      authSubject: `local:${first.teacher.id}`,
      schoolId: legacySchoolId,
      staffNo: input.teacherStaffNo.toUpperCase(),
    });
    await expect(
      database!.localCredential.findUnique({
        where: {
          identifier: teacherIdentifier("SCHARCHX", input.teacherStaffNo),
        },
        select: { userId: true, passwordHash: true },
      }),
    ).resolves.toMatchObject({ userId: first.teacher.id });
    await expect(
      database!.appUser.findUniqueOrThrow({
        where: { id: first.student.id },
        select: { authSubject: true, schoolId: true, studentNo: true },
      }),
    ).resolves.toEqual({
      authSubject: `local:${first.student.id}`,
      schoolId: legacySchoolId,
      studentNo: input.studentNo,
    });
    await expect(
      database!.classroomMembership.count({
        where: { classroomId: input.classroomId, studentId: first.student.id },
      }),
    ).resolves.toBe(1);
  });

  it("is idempotent when the same input runs concurrently", async () => {
    const input = bootstrapInput();
    const [left, right] = await Promise.all([
      bootstrapLocalClassroom(database!, input, () => firstRunAt),
      bootstrapLocalClassroom(database!, input, () => firstRunAt),
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

  it("resets lock state and revokes sessions when rotating a credential", async () => {
    const input = bootstrapInput();
    const first = await bootstrapLocalClassroom(database!, input, () => firstRunAt);
    const sessionId = randomUUID();
    await database!.$transaction([
      database!.localCredential.update({
        where: { userId: first.teacher.id },
        data: {
          failedLoginCount: 5,
          lockedUntil: new Date("2026-09-01T14:00:00.000Z"),
        },
      }),
      database!.authSession.create({
        data: {
          id: sessionId,
          userId: first.teacher.id,
          tokenHash: hashSessionToken("a".repeat(43)),
          expiresAt: new Date("2026-09-02T00:00:00.000Z"),
          createdAt: firstRunAt,
        },
      }),
    ]);

    const nextPassword = `${input.teacherPassword}-rotated`;
    await bootstrapLocalClassroom(
      database!,
      { ...input, teacherPassword: nextPassword },
      () => new Date("2026-09-01T13:00:00.000Z"),
    );

    const credential = await database!.localCredential.findUniqueOrThrow({
      where: { userId: first.teacher.id },
      select: { passwordHash: true, failedLoginCount: true, lockedUntil: true },
    });
    expect(credential.failedLoginCount).toBe(0);
    expect(credential.lockedUntil).toBeNull();
    await expect(verifyPassword(nextPassword, credential.passwordHash)).resolves.toBe(true);
    await expect(
      database!.authSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { revokedAt: true },
      }),
    ).resolves.toEqual({ revokedAt: new Date("2026-09-01T13:00:00.000Z") });
  });

  it("fails closed for a conflicting existing teacher role", async () => {
    const input = bootstrapInput();
    const teacherId = randomUUID();
    const identifier = teacherIdentifier("SCHARCHX", input.teacherStaffNo);
    await database!.appUser.create({
      data: {
        id: teacherId,
        authSubject: `local:${teacherId}`,
        role: "STUDENT",
        displayName: input.teacherDisplayName,
        schoolId: legacySchoolId,
        studentNo: input.studentNo,
      },
    });
    await database!.localCredential.create({
      data: {
        userId: teacherId,
        identifier,
        passwordHash: await hashPassword(input.teacherPassword),
      },
    });

    await expect(
      bootstrapLocalClassroom(database!, input, () => firstRunAt),
    ).rejects.toEqual(new BootstrapLocalClassroomError("USER_ROLE_CONFLICT"));
    await expect(
      database!.appUser.findUniqueOrThrow({
        where: { id: teacherId },
        select: { role: true, displayName: true },
      }),
    ).resolves.toEqual({ role: "STUDENT", displayName: input.teacherDisplayName });
  });

  it("fails atomically for profile, manager, and classroom-name conflicts", async () => {
    const input = bootstrapInput();
    const first = await bootstrapLocalClassroom(database!, input, () => firstRunAt);

    await expect(
      bootstrapLocalClassroom(
        database!,
        { ...input, teacherDisplayName: "Changed Teacher" },
        () => firstRunAt,
      ),
    ).rejects.toEqual(new BootstrapLocalClassroomError("USER_PROFILE_CONFLICT"));
    await expect(
      bootstrapLocalClassroom(
        database!,
        { ...input, classroomName: "Changed Classroom" },
        () => firstRunAt,
      ),
    ).rejects.toEqual(new BootstrapLocalClassroomError("CLASSROOM_NAME_CONFLICT"));

    const foreignManagerId = randomUUID();
    await database!.appUser.create({
      data: {
        id: foreignManagerId,
        authSubject: `local:${foreignManagerId}`,
        role: "TEACHER",
        displayName: "Foreign Manager",
        schoolId: legacySchoolId,
        staffNo: `F-${randomUUID().slice(0, 8).toUpperCase()}`,
      },
    });
    const foreignClassroomId = randomUUID();
    await database!.classroom.create({
      data: {
        id: foreignClassroomId,
        name: input.classroomName,
        managerId: foreignManagerId,
        schoolId: legacySchoolId,
      },
    });
    await expect(
      bootstrapLocalClassroom(
        database!,
        { ...input, classroomId: foreignClassroomId },
        () => firstRunAt,
      ),
    ).rejects.toEqual(new BootstrapLocalClassroomError("CLASSROOM_MANAGER_CONFLICT"));
    await expect(
      database!.classroomMembership.count({ where: { id: first.membership.id } }),
    ).resolves.toBe(1);
  });

  it("appends a current membership after the previous interval ends", async () => {
    const input = bootstrapInput();
    const first = await bootstrapLocalClassroom(database!, input, () => firstRunAt);
    await database!.classroomMembership.update({
      where: { id: first.membership.id },
      data: { endedAt: new Date("2026-09-01T13:00:00.000Z") },
    });

    const rejoined = await bootstrapLocalClassroom(
      database!,
      input,
      () => new Date("2026-09-01T14:00:00.000Z"),
    );
    expect(rejoined.membership.status).toBe("CREATED");
    expect(rejoined.membership.id).not.toBe(first.membership.id);
    await expect(
      database!.classroomMembership.count({
        where: { classroomId: input.classroomId, studentId: first.student.id },
      }),
    ).resolves.toBe(2);
  });
});
