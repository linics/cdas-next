import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import type { CommandContext } from "../commands/command-context";
import { createDatabaseClient } from "../db/client";
import { getReviewQueuePosition } from "./review-queue";
import { SubmissionWorkspaceQueryError } from "./submission-workspace";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-20T10:00:00Z");

function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

suite("N2 review queue authorization", () => {
  afterAll(async () => db?.$disconnect());

  it("reads the queue only for the releasing class manager and ignores foreign submission ids", async () => {
    const school = await db!.school.create({ data: { name: "队列测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
    const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "队列教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
    const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
    const classroom = await db!.classroom.create({ data: { name: "队列班级", schoolId: school.id, managerId: teacher.id } });
    const release = await createPublishedActivity(db!, { teacherId: teacher.id, classroomId: classroom.id, publishedAt: now, content: waterConservationTaskBookV3 });
    const input = { releaseId: release.releaseId, submissionId: randomUUID(), filter: { status: "feedback" as const, phase: null, dimension: null } };

    expect(await getReviewQueuePosition(db!, context(teacher.id), input)).toEqual({ total: 0, position: null, previousId: null, nextId: null });
    await expect(getReviewQueuePosition(db!, context(other.id), input)).rejects.toBeInstanceOf(SubmissionWorkspaceQueryError);
    await db!.classroom.update({ where: { id: classroom.id }, data: { managerId: other.id } });
    await expect(getReviewQueuePosition(db!, context(teacher.id), input)).rejects.toBeInstanceOf(SubmissionWorkspaceQueryError);
  });
});
