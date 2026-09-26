import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 as content } from "../../fixtures/water-conservation-v3";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import type { CommandContext } from "../commands/command-context";
import { copyActivityDraft } from "../commands/copy-activity-draft";
import { saveActivityDraft } from "../commands/save-activity-draft";
import { createDatabaseClient } from "../db/client";
import {
  getPrintableDraftRevision,
  getPrintableRelease,
  TaskBookPrintError,
} from "./task-book-print";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-20T10:00:00Z");

function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

async function fixture() {
  const school = await db!.school.create({ data: { name: "打印测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "打印教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const student = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "STUDENT", displayName: "学生", schoolId: school.id } });
  const classroom = await db!.classroom.create({ data: { name: "打印班级", schoolId: school.id, managerId: teacher.id } });
  return { teacher, other, student, classroom };
}

suite("N3 task book print", () => {
  afterAll(async () => db?.$disconnect());

  it("prints the exact requested draft revision, not the live draft", async () => {
    const f = await fixture();
    const draft = await saveActivityDraft(db!, context(f.teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content, idempotencyKey: randomUUID() });
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "第二版" }, idempotencyKey: randomUUID() });
    expect(await getPrintableDraftRevision(db!, context(f.teacher.id), { draftId: draft.draftId, version: 1 })).toMatchObject({ kind: "DRAFT", version: 1, content: { summary: content.summary } });
    expect(await getPrintableDraftRevision(db!, context(f.teacher.id), { draftId: draft.draftId })).toMatchObject({ version: 2, content: { summary: "第二版" } });
    await expect(getPrintableDraftRevision(db!, context(f.teacher.id), { draftId: draft.draftId, version: 9 })).rejects.toEqual(new TaskBookPrintError("NOT_FOUND"));
    for (const actor of [f.other.id]) {
      await expect(getPrintableDraftRevision(db!, context(actor), { draftId: draft.draftId })).rejects.toEqual(new TaskBookPrintError("NOT_FOUND"));
    }
    await expect(getPrintableDraftRevision(db!, context(f.student.id), { draftId: draft.draftId })).rejects.toMatchObject({ name: "TeacherActivityQueryError" });
    const legacy = await saveActivityDraft(db!, context(f.teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content: waterConservationTaskBook, idempotencyKey: randomUUID() });
    await expect(getPrintableDraftRevision(db!, context(f.teacher.id), { draftId: legacy.draftId })).rejects.toEqual(new TaskBookPrintError("UNSUPPORTED_SCHEMA"));
  });

  it("prints the frozen release snapshot for its managing publisher only", async () => {
    const f = await fixture();
    const release = await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, content });
    const copy = await copyActivityDraft(db!, context(f.teacher.id), { source: { kind: "RELEASE", id: release.releaseId, version: 1 }, title: "副本", idempotencyKey: randomUUID() });
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: copy.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, title: "副本", summary: "改过的副本" }, idempotencyKey: randomUUID() });

    const printed = await getPrintableRelease(db!, context(f.teacher.id), { releaseId: release.releaseId });
    expect(printed).toMatchObject({ kind: "RELEASE", classroomName: "打印班级", content: { summary: content.summary } });

    await expect(getPrintableRelease(db!, context(f.other.id), { releaseId: release.releaseId })).rejects.toEqual(new TaskBookPrintError("NOT_FOUND"));
    await db!.classroom.update({ where: { id: f.classroom.id }, data: { managerId: f.other.id } });
    await expect(getPrintableRelease(db!, context(f.teacher.id), { releaseId: release.releaseId })).rejects.toEqual(new TaskBookPrintError("NOT_FOUND"));
    await expect(getPrintableRelease(db!, context(f.other.id), { releaseId: release.releaseId })).rejects.toEqual(new TaskBookPrintError("NOT_FOUND"));
  });
});
