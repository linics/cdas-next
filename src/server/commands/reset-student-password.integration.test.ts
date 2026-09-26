import { randomInt, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateSchoolCode } from "../../domain/school/identity";
import { studentIdentifier } from "../auth/local-auth-primitives";
import { authenticate, changeLocalPassword, createAuthSession, getSession, hashPassword } from "../auth/local-auth";
import { createDatabaseClient } from "../db/client";
import type { CommandContext } from "./command-context";
import {
  issueStudentTemporaryPassword,
  resetStudentPassword,
  ResetStudentPasswordError,
} from "./reset-student-password";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-20T10:00:00Z");
const oldPassword = "OldPassword2026";

function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

async function fixture() {
  const school = await db!.school.create({ data: { name: "恢复测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "班主任", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const studentId = randomUUID();
  const studentNo = String(randomInt(10 ** 7, 10 ** 8));
  await db!.appUser.create({ data: { id: studentId, authSubject: `local:${studentId}`, role: "STUDENT", displayName: "忘密码的学生", schoolId: school.id, studentNo } });
  const identifier = studentIdentifier(school.code, studentNo);
  await db!.localCredential.create({ data: { userId: studentId, identifier, passwordHash: await hashPassword(oldPassword), failedLoginCount: 5, lockedUntil: new Date(now.getTime() + 60_000) } });
  const classroom = await db!.classroom.create({ data: { name: "恢复班级", schoolId: school.id, managerId: teacher.id } });
  const otherClassroom = await db!.classroom.create({ data: { name: "别的班", schoolId: school.id, managerId: other.id } });
  await db!.classroomMembership.create({ data: { classroomId: classroom.id, studentId, joinedAt: new Date(now.getTime() - 86_400_000) } });
  return { school, teacher, other, studentId, studentNo, identifier, classroom, otherClassroom };
}

suite("N5 student password reset", () => {
  afterAll(async () => db?.$disconnect());

  it("issues a readable temporary password that never follows the student number", () => {
    for (let index = 0; index < 50; index += 1) {
      const password = issueStudentTemporaryPassword();
      expect(password).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      expect(password).not.toMatch(/^cdas/i);
    }
  });

  it("resets, ends old sessions, clears lockout and forces a change; plaintext is stored nowhere", async () => {
    const f = await fixture();
    const oldSession = await createAuthSession(db!, f.studentId, now);
    const input = { classroomId: f.classroom.id, studentId: f.studentId, idempotencyKey: randomUUID() };
    const { temporaryPassword } = await resetStudentPassword(db!, context(f.teacher.id), input);

    expect(await getSession(db!, oldSession.token, now)).toBeNull();
    expect(await authenticate(db!, f.identifier, oldPassword, "STUDENT", now)).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
    const signIn = await authenticate(db!, f.identifier, temporaryPassword, "STUDENT", now);
    expect(signIn).toMatchObject({ ok: true, mustChangePassword: true });

    await changeLocalPassword(db!, f.studentId, "NewPassword2026", now);
    expect(await authenticate(db!, f.identifier, temporaryPassword, "STUDENT", now)).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });

    const records = JSON.stringify([
      await db!.idempotencyRecord.findMany({ where: { commandName: "reset_student_password", actorId: f.teacher.id } }),
      await db!.actionAudit.findMany({ where: { actionName: "reset_student_password", targetId: f.studentId } }),
    ]);
    expect(records).not.toContain(temporaryPassword);

    // Same key again: no new password, no plaintext.
    await expect(resetStudentPassword(db!, context(f.teacher.id), input)).rejects.toEqual(new ResetStudentPasswordError("PASSWORD_ALREADY_ISSUED"));
    expect(await authenticate(db!, f.identifier, "NewPassword2026", "STUDENT", now)).toMatchObject({ ok: true });
  });

  it("leaves exactly the last issued password valid when two resets race", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      resetStudentPassword(db!, context(f.teacher.id), { classroomId: f.classroom.id, studentId: f.studentId, idempotencyKey: randomUUID() }),
      resetStudentPassword(db!, context(f.teacher.id), { classroomId: f.classroom.id, studentId: f.studentId, idempotencyKey: randomUUID() }),
    ]);
    const issued = results.flatMap((result) => (result.status === "fulfilled" ? [result.value.temporaryPassword] : []));
    expect(issued.length).toBeGreaterThan(0);
    const valid = [];
    for (const password of issued) {
      const outcome = await authenticate(db!, f.identifier, password, "STUDENT", now);
      if (outcome.ok) valid.push(password);
    }
    expect(valid).toHaveLength(1);
  });

  it("refuses other classes' teachers, former members, disabled accounts and students without local login", async () => {
    const f = await fixture();
    const attempt = (actorId: string, classroomId = f.classroom.id) =>
      resetStudentPassword(db!, context(actorId), { classroomId, studentId: f.studentId, idempotencyKey: randomUUID() });

    await expect(attempt(f.other.id)).rejects.toEqual(new ResetStudentPasswordError("NOT_FOUND"));
    await expect(attempt(f.other.id, f.otherClassroom.id)).rejects.toEqual(new ResetStudentPasswordError("NOT_FOUND"));
    await expect(attempt(f.studentId)).rejects.toBeInstanceOf(ResetStudentPasswordError);

    await db!.appUser.update({ where: { id: f.studentId }, data: { accountStatus: "DISABLED" } });
    await expect(attempt(f.teacher.id)).rejects.toEqual(new ResetStudentPasswordError("ACCOUNT_DISABLED"));
    expect((await db!.appUser.findUniqueOrThrow({ where: { id: f.studentId } })).accountStatus).toBe("DISABLED");
    await db!.appUser.update({ where: { id: f.studentId }, data: { accountStatus: "ACTIVE" } });

    await db!.classroomMembership.updateMany({ where: { studentId: f.studentId }, data: { endedAt: new Date(now.getTime() - 1000) } });
    await expect(attempt(f.teacher.id)).rejects.toEqual(new ResetStudentPasswordError("NOT_FOUND"));

    expect(await authenticate(db!, f.identifier, oldPassword, "STUDENT", new Date(now.getTime() + 120_000))).toMatchObject({ ok: true });
  });
});
