import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateSchoolCode } from "../../domain/school/identity";
import { createDatabaseClient } from "../db/client";
import type { CommandContext } from "./command-context";
import { createClassroom, CreateClassroomError } from "./create-classroom";
import {
  deleteEmptyClassroom,
  DeleteClassroomError,
} from "./delete-classroom";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const now = new Date("2026-09-01T02:00:00.000Z");

function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

async function fixture(schoolStatus: "ACTIVE" | "DISABLED" = "ACTIVE") {
  if (!database) throw new Error("TEST_DATABASE_URL is required");
  const school = await database.school.create({
    data: {
      name: "创建班级测试学校",
      code: generateSchoolCode(),
      teacherInviteCodeHash: "b".repeat(64),
      status: schoolStatus,
    },
    select: { id: true },
  });
  const teacher = await database.appUser.create({
    data: {
      authSubject: `local:${randomUUID()}`,
      role: "TEACHER",
      displayName: "建班教师",
      schoolId: school.id,
      staffNo: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
    },
    select: { id: true },
  });
  const student = await database.appUser.create({
    data: {
      authSubject: `local:${randomUUID()}`,
      role: "STUDENT",
      displayName: "学生",
      schoolId: school.id,
      studentNo: String(Date.now()).slice(-10),
    },
    select: { id: true },
  });
  return { schoolId: school.id, teacherId: teacher.id, studentId: student.id };
}

describeWithDatabase("createClassroom", () => {
  afterAll(async () => database?.$disconnect());

  it("creates a classroom in the teacher's own school and replays the same request", async () => {
    const value = await fixture();
    const input = { name: " 八年级（3）班 ", idempotencyKey: `create_classroom_${randomUUID()}` };
    const created = await createClassroom(database!, context(value.teacherId), input);
    expect(created).toMatchObject({ name: "八年级（3）班", schoolId: value.schoolId });
    expect(await createClassroom(database!, context(value.teacherId), input)).toEqual(created);

    const stored = await database!.classroom.findUniqueOrThrow({
      where: { id: created.classroomId },
      select: { managerId: true, schoolId: true, version: true },
    });
    expect(stored).toEqual({
      managerId: value.teacherId,
      schoolId: value.schoolId,
      version: 1,
    });
    expect(
      await database!.actionAudit.count({
        where: { targetId: created.classroomId, actionName: "create_classroom", outcome: "SUCCEEDED" },
      }),
    ).toBe(1);
  });

  it("refuses a second classroom with the same name for the same teacher", async () => {
    const value = await fixture();
    await createClassroom(database!, context(value.teacherId), {
      name: "重名班",
      idempotencyKey: `create_classroom_${randomUUID()}`,
    });
    await expect(
      createClassroom(database!, context(value.teacherId), {
        name: "重名班",
        idempotencyKey: `create_classroom_${randomUUID()}`,
      }),
    ).rejects.toEqual(new CreateClassroomError("DUPLICATE_NAME"));
    expect(await database!.classroom.count({ where: { managerId: value.teacherId } })).toBe(1);
  });

  it("refuses a student and a teacher of a disabled school", async () => {
    const value = await fixture();
    await expect(
      createClassroom(database!, context(value.studentId), {
        name: "学生建班",
        idempotencyKey: `create_classroom_${randomUUID()}`,
      }),
    ).rejects.toEqual(new CreateClassroomError("FORBIDDEN"));

    const disabled = await fixture("DISABLED");
    await expect(
      createClassroom(database!, context(disabled.teacherId), {
        name: "停用校建班",
        idempotencyKey: `create_classroom_${randomUUID()}`,
      }),
    ).rejects.toEqual(new CreateClassroomError("SCHOOL_DISABLED"));
    expect(await database!.classroom.count({ where: { schoolId: disabled.schoolId } })).toBe(0);
  });

  it("deletes an empty classroom once and replays the recorded outcome", async () => {
    const value = await fixture();
    const created = await createClassroom(database!, context(value.teacherId), {
      name: "待删除空班",
      idempotencyKey: `create_classroom_${randomUUID()}`,
    });
    const input = {
      classroomId: created.classroomId,
      idempotencyKey: `delete_classroom_${randomUUID()}`,
    };

    const deleted = await deleteEmptyClassroom(
      database!,
      context(value.teacherId),
      input,
    );
    expect(await deleteEmptyClassroom(database!, context(value.teacherId), input)).toEqual(deleted);
    expect(await database!.classroom.findUnique({ where: { id: created.classroomId } })).toBeNull();
    expect(
      await database!.actionAudit.count({
        where: {
          targetId: created.classroomId,
          actionName: "delete_empty_classroom",
          outcome: "SUCCEEDED",
        },
      }),
    ).toBe(1);
  });

  it("preserves every classroom that has a membership interval", async () => {
    const value = await fixture();
    const created = await createClassroom(database!, context(value.teacherId), {
      name: "已有成员历史的班",
      idempotencyKey: `create_classroom_${randomUUID()}`,
    });
    await database!.classroomMembership.create({
      data: {
        classroomId: created.classroomId,
        studentId: value.studentId,
        joinedAt: now,
        endedAt: new Date(now.getTime() + 1_000),
      },
    });

    await expect(
      deleteEmptyClassroom(database!, context(value.teacherId), {
        classroomId: created.classroomId,
        idempotencyKey: `delete_classroom_${randomUUID()}`,
      }),
    ).rejects.toEqual(new DeleteClassroomError("NOT_EMPTY"));
    expect(await database!.classroom.findUnique({ where: { id: created.classroomId } })).not.toBeNull();
  });
});
