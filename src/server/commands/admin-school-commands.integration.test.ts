import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../db/client";
import { bootstrapPlatformAdmin } from "../bootstrap/bootstrap-admin";
import {
  createSchool,
  resetSchoolTeacherInvite,
  SchoolAdminCommandError,
  setSchoolStatus,
} from "./admin-school-commands";
import {
  registerSchoolTeacher,
  setTeacherAccountStatus,
  TeacherAdminCommandError,
} from "./admin-teacher-commands";
import type { CommandContext } from "./command-context";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const now = new Date("2026-09-01T03:00:00.000Z");

function context(actorId: string): CommandContext {
  return {
    actorId,
    source: "UI",
    traceId: randomUUID(),
    clock: () => now,
  };
}

async function ensureTestAdmin(): Promise<string> {
  const existing = await database!.appUser.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }
  const created = await bootstrapPlatformAdmin(database!, {
    adminAuthSubject: `user_admin${randomUUID().replaceAll("-", "")}`,
    adminDisplayName: "平台管理员",
  });
  return created.admin.id;
}

describeWithDatabase("school admin commands", () => {
  afterAll(async () => {
    await database?.$disconnect();
  });

  it("lets the platform admin create isolated schools and pending teachers", async () => {
    const adminId = await ensureTestAdmin();
    const createKey = `create_a_${randomUUID()}`;
    const schoolA = await createSchool(database!, context(adminId), {
      name: "第一实验学校",
      idempotencyKey: createKey,
    });
    const replay = await createSchool(database!, context(adminId), {
      name: "第一实验学校",
      idempotencyKey: createKey,
    });
    expect(replay).toMatchObject({
      schoolId: schoolA.schoolId,
      status: "EXISTING",
      teacherInviteCode: null,
    });

    const schoolB = await createSchool(database!, context(adminId), {
      name: "第二实验学校",
      idempotencyKey: `create_b_${randomUUID()}`,
    });
    expect(schoolA.schoolCode).not.toBe(schoolB.schoolCode);
    expect(schoolA.teacherInviteCode).toBeTruthy();

    const teacherA = await registerSchoolTeacher(database!, context(adminId), {
      schoolId: schoolA.schoolId,
      displayName: "甲老师",
      staffNo: "T001",
      idempotencyKey: `reg_a_${randomUUID()}`,
    });
    const teacherB = await registerSchoolTeacher(database!, context(adminId), {
      schoolId: schoolB.schoolId,
      displayName: "乙老师",
      staffNo: "T001",
      idempotencyKey: `reg_b_${randomUUID()}`,
    });
    expect(teacherA.teacherId).not.toBe(teacherB.teacherId);

    await expect(
      registerSchoolTeacher(database!, context(adminId), {
        schoolId: schoolA.schoolId,
        displayName: "丙老师",
        staffNo: "T001",
        idempotencyKey: `reg_dup_${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "STAFF_NO_CONFLICT" } satisfies Pick<
      TeacherAdminCommandError,
      "code"
    >);

    const reset = await resetSchoolTeacherInvite(
      database!,
      context(adminId),
      { schoolId: schoolA.schoolId, idempotencyKey: `invite_${randomUUID()}` },
    );
    expect(reset.teacherInviteCode).toBeTruthy();
    expect(reset.teacherInviteCode).not.toBe(schoolA.teacherInviteCode);

    await setSchoolStatus(database!, context(adminId), {
      schoolId: schoolA.schoolId,
      status: "DISABLED",
      idempotencyKey: `disable_${randomUUID()}`,
    });
    await expect(
      registerSchoolTeacher(database!, context(adminId), {
        schoolId: schoolA.schoolId,
        displayName: "丁老师",
        staffNo: "T009",
        idempotencyKey: `reg_disabled_${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "SCHOOL_DISABLED" } satisfies Pick<
      TeacherAdminCommandError,
      "code"
    >);

    await setTeacherAccountStatus(database!, context(adminId), {
      teacherId: teacherB.teacherId,
      accountStatus: "DISABLED",
      idempotencyKey: `teacher_off_${randomUUID()}`,
    });
    const stored = await database!.appUser.findUnique({
      where: { id: teacherB.teacherId },
      select: { accountStatus: true, teacherProvisioning: { select: { status: true } } },
    });
    expect(stored).toMatchObject({
      accountStatus: "DISABLED",
      teacherProvisioning: { status: "PENDING" },
    });
  });

  it("hides school commands from teachers", async () => {
    const teacher = await database!.appUser.create({
      data: {
        authSubject: `user_teacher${randomUUID().replaceAll("-", "")}`,
        role: "TEACHER",
        displayName: "普通教师",
      },
      select: { id: true },
    });
    await expect(
      createSchool(database!, context(teacher.id), {
        name: "不该出现的学校",
        idempotencyKey: `forbid_${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Pick<
      SchoolAdminCommandError,
      "code"
    >);
  });

  it("rechecks ACTIVE ADMIN before replaying a successful command", async () => {
    const adminId = await ensureTestAdmin();
    const idempotencyKey = `active_replay_${randomUUID()}`;
    await createSchool(database!, context(adminId), {
      name: "管理员回放门禁测试学校",
      idempotencyKey,
    });

    await database!.appUser.update({
      where: { id: adminId },
      data: { accountStatus: "DISABLED" },
    });
    try {
      await expect(
        createSchool(database!, context(adminId), {
          name: "管理员回放门禁测试学校",
          idempotencyKey,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Pick<
        SchoolAdminCommandError,
        "code"
      >);
    } finally {
      await database!.appUser.update({
        where: { id: adminId },
        data: { accountStatus: "ACTIVE" },
      });
    }
  });
});
