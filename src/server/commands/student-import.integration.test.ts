import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateSchoolCode } from "../../domain/school/identity";
import { authenticate } from "../auth/local-auth";
import { studentIdentifier } from "../auth/local-auth-primitives";
import { createDatabaseClient } from "../db/client";
import { previewStudentImport } from "../queries/teacher-classroom-roster";
import type { CommandContext } from "./command-context";
import { decideActionIntent } from "./decide-action-intent";
import {
  executeStudentImport,
  prepareStudentImport,
  StudentImportError,
} from "./student-import";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const now = new Date("2026-09-01T03:00:00.000Z");

function context(actorId: string, at: Date = now): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => at };
}

let studentNoSequence = 0;
function studentNo(): string {
  studentNoSequence += 1;
  return `${String(Date.now()).slice(-7)}${String(studentNoSequence).padStart(3, "0")}`;
}

async function fixture() {
  if (!database) throw new Error("TEST_DATABASE_URL is required");
  const schoolCode = generateSchoolCode();
  const school = await database.school.create({
    data: {
      name: "导入测试学校",
      code: schoolCode,
      teacherInviteCodeHash: "c".repeat(64),
    },
    select: { id: true, code: true },
  });
  const [teacher, otherTeacher] = await Promise.all([
    database.appUser.create({
      data: {
        authSubject: `local:${randomUUID()}`,
        role: "TEACHER",
        displayName: "导入教师",
        schoolId: school.id,
        staffNo: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
      },
      select: { id: true },
    }),
    database.appUser.create({
      data: {
        authSubject: `local:${randomUUID()}`,
        role: "TEACHER",
        displayName: "其他教师",
        schoolId: school.id,
        staffNo: randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(),
      },
      select: { id: true },
    }),
  ]);
  const classroom = await database.classroom.create({
    data: { name: `八年级${randomUUID().slice(0, 8)}班`, managerId: teacher.id, schoolId: school.id },
    select: { id: true, name: true },
  });
  return { school, teacherId: teacher.id, otherTeacherId: otherTeacher.id, classroom };
}

async function importEntries(
  teacherId: string,
  classroomId: string,
  entries: readonly { studentNo: string; displayName: string }[],
  at: Date = now,
) {
  const prepared = await prepareStudentImport(database!, context(teacherId, at), {
    classroomId,
    entries: [...entries],
    idempotencyKey: `prepare_student_import_${randomUUID()}`,
  });
  await decideActionIntent(database!, context(teacherId, at), {
    actionIntentId: prepared.actionIntentId,
    decision: "CONFIRM",
  });
  const applyInput = {
    actionIntentId: prepared.actionIntentId,
    idempotencyKey: `apply_student_import_${randomUUID()}`,
  };
  const result = await executeStudentImport(database!, context(teacherId, at), applyInput);
  return { prepared, applyInput, result };
}

describeWithDatabase("student roster import", () => {
  afterAll(async () => database?.$disconnect());

  it("creates accounts a student can sign in with, and replays the confirmed import", async () => {
    const value = await fixture();
    const first = studentNo();
    const second = studentNo();
    const { prepared, applyInput, result } = await importEntries(
      value.teacherId,
      value.classroom.id,
      [
        { studentNo: first, displayName: "张三" },
        { studentNo: second, displayName: "李四" },
      ],
    );
    expect(prepared).toMatchObject({
      classroomId: value.classroom.id,
      classroomName: value.classroom.name,
      expectedClassroomVersion: 1,
    });
    expect(prepared.entries.map((entry) => entry.status)).toEqual(["CREATE", "CREATE"]);
    expect(result).toEqual({
      classroomId: value.classroom.id,
      createdStudents: 2,
      reusedStudents: 0,
      joinedStudents: 2,
      skippedCurrentMembers: 0,
    });
    // A retried browser submission must not create a second set of accounts.
    expect(await executeStudentImport(database!, context(value.teacherId), applyInput)).toEqual(result);
    expect(
      await database!.appUser.count({
        where: { schoolId: value.school.id, role: "STUDENT" },
      }),
    ).toBe(2);

    const created = await database!.appUser.findUniqueOrThrow({
      where: { schoolId_studentNo: { schoolId: value.school.id, studentNo: first } },
      select: { id: true, displayName: true, accountStatus: true, authSubject: true, legacyProfile: true },
    });
    expect(created).toMatchObject({
      displayName: "张三",
      accountStatus: "ACTIVE",
      legacyProfile: false,
      authSubject: `local:${created.id}`,
    });
    expect(
      await database!.classroomMembership.count({
        where: { classroomId: value.classroom.id, endedAt: null },
      }),
    ).toBe(2);
    expect(
      (await database!.classroom.findUniqueOrThrow({
        where: { id: value.classroom.id },
        select: { version: true },
      })).version,
    ).toBe(2);

    const login = await authenticate(
      database!,
      studentIdentifier(value.school.code, first),
      `cdas${first}`,
      "STUDENT",
    );
    expect(login).toMatchObject({ ok: true, userId: created.id, mustChangePassword: true });
    expect(
      await authenticate(
        database!,
        studentIdentifier(value.school.code, first),
        "wrong-password-1",
        "STUDENT",
      ),
    ).toMatchObject({ ok: false, code: "INVALID_CREDENTIALS" });

    await database!.school.update({
      where: { id: value.school.id },
      data: { status: "DISABLED" },
    });
    expect(await executeStudentImport(database!, context(value.teacherId), applyInput)).toEqual(result);
  });

  it("reuses an existing account, skips a current member, and reports conflicts before any write", async () => {
    const value = await fixture();
    const existing = studentNo();
    const fresh = studentNo();
    await importEntries(value.teacherId, value.classroom.id, [
      { studentNo: existing, displayName: "已有学生" },
    ]);
    const otherClassroom = await database!.classroom.create({
      data: {
        name: `另一个班${randomUUID().slice(0, 8)}`,
        managerId: value.teacherId,
        schoolId: value.school.id,
      },
      select: { id: true },
    });
    const elsewhere = studentNo();
    await importEntries(value.teacherId, otherClassroom.id, [
      { studentNo: elsewhere, displayName: "别班学生" },
    ]);

    const preview = await previewStudentImport(database!, context(value.teacherId), {
      classroomId: value.classroom.id,
      rows: [
        { rowNumber: 2, entry: { studentNo: existing, displayName: "改过的名字" } },
        { rowNumber: 3, entry: { studentNo: fresh, displayName: "新学生" } },
        { rowNumber: 4, entry: { studentNo: elsewhere, displayName: "别班学生" } },
      ],
    });
    expect(preview.rows.map((row) => row.status)).toEqual([
      "ALREADY_CURRENT",
      "CREATE",
      "CONFLICT_OTHER_CLASSROOM",
    ]);
    expect(preview.rows[0]).toMatchObject({ existingDisplayName: "已有学生" });

    // The conflicting row can never reach a payload: preparing it fails whole.
    await expect(
      prepareStudentImport(database!, context(value.teacherId), {
        classroomId: value.classroom.id,
        entries: [
          { studentNo: fresh, displayName: "新学生" },
          { studentNo: elsewhere, displayName: "别班学生" },
        ],
        idempotencyKey: `prepare_student_import_${randomUUID()}`,
      }),
    ).rejects.toEqual(new StudentImportError("PREVIEW_STALE"));
    expect(await database!.actionIntent.count({ where: { targetId: value.classroom.id } })).toBe(1);

    const { result } = await importEntries(value.teacherId, value.classroom.id, [
      { studentNo: fresh, displayName: "新学生" },
    ]);
    expect(result).toMatchObject({ createdStudents: 1, joinedStudents: 1 });
    // The existing account keeps the name it was created with.
    expect(
      (await database!.appUser.findUniqueOrThrow({
        where: { schoolId_studentNo: { schoolId: value.school.id, studentNo: existing } },
        select: { displayName: true },
      })).displayName,
    ).toBe("已有学生");
  });

  it("re-adds a student whose membership ended without duplicating the account", async () => {
    const value = await fixture();
    const number = studentNo();
    await importEntries(value.teacherId, value.classroom.id, [
      { studentNo: number, displayName: "回归学生" },
    ]);
    const membership = await database!.classroomMembership.findFirstOrThrow({
      where: { classroomId: value.classroom.id },
      select: { id: true },
    });
    await database!.classroomMembership.update({
      where: { id: membership.id },
      data: { endedAt: new Date(now.getTime() + 1_000) },
    });

    const later = new Date(now.getTime() + 60_000);
    const { prepared, result } = await importEntries(
      value.teacherId,
      value.classroom.id,
      [{ studentNo: number, displayName: "回归学生" }],
      later,
    );
    expect(prepared.entries[0]).toMatchObject({ status: "REUSE" });
    expect(result).toMatchObject({ createdStudents: 0, reusedStudents: 1, joinedStudents: 1 });
    expect(
      await database!.appUser.count({ where: { schoolId: value.school.id, studentNo: number } }),
    ).toBe(1);
    expect(
      await database!.classroomMembership.count({ where: { classroomId: value.classroom.id } }),
    ).toBe(2);
  });

  it("refuses another teacher's classroom, an unconfirmed intent, and a stale classroom version", async () => {
    const value = await fixture();
    const number = studentNo();
    await expect(
      prepareStudentImport(database!, context(value.otherTeacherId), {
        classroomId: value.classroom.id,
        entries: [{ studentNo: number, displayName: "越权学生" }],
        idempotencyKey: `prepare_student_import_${randomUUID()}`,
      }),
    ).rejects.toEqual(new StudentImportError("NOT_FOUND"));

    const prepared = await prepareStudentImport(database!, context(value.teacherId), {
      classroomId: value.classroom.id,
      entries: [{ studentNo: number, displayName: "待确认学生" }],
      idempotencyKey: `prepare_student_import_${randomUUID()}`,
    });
    await expect(
      executeStudentImport(database!, context(value.teacherId), {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: `apply_student_import_${randomUUID()}`,
      }),
    ).rejects.toEqual(new StudentImportError("ACTION_NOT_CONFIRMED"));
    expect(
      await database!.appUser.count({ where: { schoolId: value.school.id, role: "STUDENT" } }),
    ).toBe(0);

    await decideActionIntent(database!, context(value.teacherId), {
      actionIntentId: prepared.actionIntentId,
      decision: "CONFIRM",
    });
    await database!.classroom.update({
      where: { id: value.classroom.id },
      data: { version: { increment: 1 } },
    });
    await expect(
      executeStudentImport(database!, context(value.teacherId), {
        actionIntentId: prepared.actionIntentId,
        idempotencyKey: `apply_student_import_${randomUUID()}`,
      }),
    ).rejects.toEqual(new StudentImportError("CLASSROOM_CHANGED"));
    expect(
      await database!.appUser.count({ where: { schoolId: value.school.id, role: "STUDENT" } }),
    ).toBe(0);
  });

  it("refuses to import into a classroom of a disabled school", async () => {
    const value = await fixture();
    await database!.school.update({
      where: { id: value.school.id },
      data: { status: "DISABLED" },
    });
    await expect(
      prepareStudentImport(database!, context(value.teacherId), {
        classroomId: value.classroom.id,
        entries: [{ studentNo: studentNo(), displayName: "停用校学生" }],
        idempotencyKey: `prepare_student_import_${randomUUID()}`,
      }),
    ).rejects.toEqual(new StudentImportError("SCHOOL_DISABLED"));
  });
});
