import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabaseClient } from "../db/client";
import {
  getTeacherClassroomRoster,
  previewTeacherRosterImport,
  TeacherClassroomRosterQueryError,
} from "../queries/teacher-classroom-roster";
import {
  applyClassroomMembershipChange,
  ApplyClassroomMembershipChangeError,
} from "./apply-classroom-membership-change";
import type { CommandContext, CommandSource } from "./command-context";
import { decideActionIntent } from "./decide-action-intent";
import {
  prepareClassroomMembershipChange,
  PrepareClassroomMembershipChangeError,
} from "./prepare-classroom-membership-change";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const database = databaseUrl ? createDatabaseClient(databaseUrl) : null;

function context(
  actorId: string,
  now: Date,
  source: CommandSource = "UI",
): CommandContext {
  return { actorId, source, traceId: randomUUID(), clock: () => now };
}

function rosterKey(): string {
  return `S${randomUUID().replaceAll("-", "").slice(0, 15).toUpperCase()}`;
}

async function fixture() {
  if (!database) throw new Error("TEST_DATABASE_URL is required");
  const teacherId = randomUUID();
  const otherTeacherId = randomUUID();
  const currentStudentId = randomUUID();
  const candidateStudentId = randomUUID();
  const classroomId = randomUUID();
  const now = new Date("2026-08-24T08:00:00.000Z");
  const currentRosterKey = rosterKey();
  const candidateRosterKey = rosterKey();
  await database.appUser.createMany({
    data: [
      { id: teacherId, authSubject: `teacher_${teacherId}`, role: "TEACHER", displayName: "班级教师" },
      { id: otherTeacherId, authSubject: `teacher_${otherTeacherId}`, role: "TEACHER", displayName: "其他教师" },
      { id: currentStudentId, authSubject: `student_${currentStudentId}`, role: "STUDENT", displayName: "当前学生", rosterKey: currentRosterKey },
      { id: candidateStudentId, authSubject: `student_${candidateStudentId}`, role: "STUDENT", displayName: "待加入学生", rosterKey: candidateRosterKey },
    ],
  });
  await database.classroom.create({
    data: { id: classroomId, name: "八年二班", managerId: teacherId },
  });
  const currentMembership = await database.classroomMembership.create({
    data: {
      classroomId,
      studentId: currentStudentId,
      joinedAt: new Date("2026-08-20T08:00:00.000Z"),
    },
  });
  return {
    teacherId,
    otherTeacherId,
    currentStudentId,
    candidateStudentId,
    classroomId,
    now,
    currentRosterKey,
    candidateRosterKey,
    currentMembershipId: currentMembership.id,
  };
}

async function confirm(actorId: string, now: Date, actionIntentId: string) {
  await decideActionIntent(database!, context(actorId, now), {
    actionIntentId,
    decision: "CONFIRM",
  });
}

describeWithDatabase("teacher classroom membership changes", () => {
  afterAll(async () => database?.$disconnect());

  it("adds, ends, and re-adds a student without overwriting membership history", async () => {
    const value = await fixture();
    const prepareInput = {
      operation: "ADD" as const,
      classroomId: value.classroomId,
      rosterKeys: [value.candidateRosterKey],
      idempotencyKey: `prepare_roster_${randomUUID()}`,
    };
    const prepared = await prepareClassroomMembershipChange(
      database!,
      context(value.teacherId, value.now),
      prepareInput,
    );
    expect(
      await prepareClassroomMembershipChange(
        database!,
        context(value.teacherId, value.now),
        prepareInput,
      ),
    ).toEqual(prepared);
    expect(prepared).toMatchObject({
      operation: "ADD",
      classroomId: value.classroomId,
      expectedClassroomVersion: 1,
      students: [{ studentId: value.candidateStudentId, displayName: "待加入学生" }],
    });
    await confirm(value.teacherId, value.now, prepared.actionIntentId);
    const applyInput = {
      actionIntentId: prepared.actionIntentId,
      idempotencyKey: `apply_roster_${randomUUID()}`,
    };
    const added = await applyClassroomMembershipChange(
      database!,
      context(value.teacherId, value.now),
      applyInput,
    );
    expect(
      await applyClassroomMembershipChange(
        database!,
        context(value.teacherId, value.now),
        applyInput,
      ),
    ).toEqual(added);
    expect(added).toMatchObject({
      operation: "ADD",
      classroomVersion: 2,
      changedStudentIds: [value.candidateStudentId],
    });

    const addedMembershipId = added.changedMembershipIds[0]!;
    const endAt = new Date(value.now.getTime() + 1_000);
    const preparedEnd = await prepareClassroomMembershipChange(
      database!,
      context(value.teacherId, endAt),
      {
        operation: "END",
        classroomId: value.classroomId,
        membershipId: addedMembershipId,
        idempotencyKey: `prepare_end_${randomUUID()}`,
      },
    );
    await confirm(value.teacherId, endAt, preparedEnd.actionIntentId);
    const ended = await applyClassroomMembershipChange(
      database!,
      context(value.teacherId, endAt),
      {
        actionIntentId: preparedEnd.actionIntentId,
        idempotencyKey: `apply_end_${randomUUID()}`,
      },
    );
    expect(ended).toMatchObject({ operation: "END", classroomVersion: 3 });

    const rejoinAt = new Date(value.now.getTime() + 2_000);
    const preparedRejoin = await prepareClassroomMembershipChange(
      database!,
      context(value.teacherId, rejoinAt),
      {
        operation: "ADD",
        classroomId: value.classroomId,
        rosterKeys: [value.candidateRosterKey],
        idempotencyKey: `prepare_rejoin_${randomUUID()}`,
      },
    );
    await confirm(value.teacherId, rejoinAt, preparedRejoin.actionIntentId);
    await applyClassroomMembershipChange(
      database!,
      context(value.teacherId, rejoinAt),
      {
        actionIntentId: preparedRejoin.actionIntentId,
        idempotencyKey: `apply_rejoin_${randomUUID()}`,
      },
    );

    const intervals = await database!.classroomMembership.findMany({
      where: { classroomId: value.classroomId, studentId: value.candidateStudentId },
      orderBy: { joinedAt: "asc" },
      select: { id: true, joinedAt: true, endedAt: true },
    });
    expect(intervals).toEqual([
      { id: addedMembershipId, joinedAt: value.now, endedAt: endAt },
      { id: expect.any(String), joinedAt: rejoinAt, endedAt: null },
    ]);
    expect(
      await database!.actionAudit.count({
        where: {
          actionName: "apply_classroom_membership_change",
          targetId: value.classroomId,
          outcome: "SUCCEEDED",
        },
      }),
    ).toBe(3);
  });

  it("hides foreign classrooms, rejects Agent use, and invalidates a stale class version", async () => {
    const value = await fixture();
    const roster = await getTeacherClassroomRoster(
      database!,
      context(value.teacherId, value.now),
      { classroomId: value.classroomId },
    );
    expect(roster.memberships).toHaveLength(1);
    expect(roster.memberships[0]).not.toHaveProperty("rosterKey");
    expect(
      await previewTeacherRosterImport(
        database!,
        context(value.teacherId, value.now),
        {
          classroomId: value.classroomId,
          rosterKeys: [value.currentRosterKey, value.candidateRosterKey, "UNKNOWN0001"],
        },
      ),
    ).toMatchObject({
      entries: [
        { rosterKey: value.currentRosterKey, status: "ALREADY_CURRENT" },
        { rosterKey: value.candidateRosterKey, status: "READY" },
        { rosterKey: "UNKNOWN0001", status: "NOT_FOUND" },
      ],
    });
    await expect(
      getTeacherClassroomRoster(
        database!,
        context(value.otherTeacherId, value.now),
        { classroomId: value.classroomId },
      ),
    ).rejects.toEqual(new TeacherClassroomRosterQueryError("NOT_FOUND"));
    await expect(
      getTeacherClassroomRoster(
        database!,
        context(value.currentStudentId, value.now),
        { classroomId: value.classroomId },
      ),
    ).rejects.toEqual(new TeacherClassroomRosterQueryError("FORBIDDEN"));
    await expect(
      prepareClassroomMembershipChange(
        database!,
        context(value.otherTeacherId, value.now),
        {
          operation: "ADD",
          classroomId: value.classroomId,
          rosterKeys: [value.candidateRosterKey],
          idempotencyKey: `foreign_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new PrepareClassroomMembershipChangeError("NOT_FOUND"));
    await expect(
      prepareClassroomMembershipChange(
        database!,
        context(value.teacherId, value.now, "AGENT"),
        {
          operation: "ADD",
          classroomId: value.classroomId,
          rosterKeys: [value.candidateRosterKey],
          idempotencyKey: `agent_${randomUUID()}`,
        },
      ),
    ).rejects.toThrow(/not allowed/u);

    const prepared = await prepareClassroomMembershipChange(
      database!,
      context(value.teacherId, value.now),
      {
        operation: "ADD",
        classroomId: value.classroomId,
        rosterKeys: [value.candidateRosterKey],
        idempotencyKey: `stale_${randomUUID()}`,
      },
    );
    await confirm(value.teacherId, value.now, prepared.actionIntentId);
    await database!.classroom.update({
      where: { id: value.classroomId },
      data: { version: { increment: 1 } },
    });
    await expect(
      applyClassroomMembershipChange(
        database!,
        context(value.teacherId, value.now),
        {
          actionIntentId: prepared.actionIntentId,
          idempotencyKey: `apply_stale_${randomUUID()}`,
        },
      ),
    ).rejects.toEqual(new ApplyClassroomMembershipChangeError("CLASSROOM_CHANGED"));
    expect(
      await database!.classroomMembership.count({
        where: { classroomId: value.classroomId, studentId: value.candidateStudentId },
      }),
    ).toBe(0);
  });

  it("lets PostgreSQL reject roster-key rewrites and membership history deletion", async () => {
    const value = await fixture();
    await expect(
      database!.appUser.update({
        where: { id: value.currentStudentId },
        data: { rosterKey: rosterKey() },
      }),
    ).rejects.toThrow(/roster key is immutable/u);
    await expect(
      database!.classroomMembership.delete({
        where: { id: value.currentMembershipId },
      }),
    ).rejects.toThrow(/history cannot be deleted/u);
  });
});
