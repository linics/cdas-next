import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { waterConservationActivity, waterConservationTaskBook } from "../../fixtures/water-conservation";
import type { PrismaClient } from "../../generated/prisma/client";
import { createPublishedActivity, closePublishedActivity } from "../../test/fixtures/published-activity";
import { ActivityCopyError } from "../activity/activity-copy-source";
import { createDatabaseClient } from "../db/client";
import { getActivityCopyPreview, getActivityCopySources, getActivityDraftOrigin } from "../queries/activity-copy-workspace";
import type { CommandContext } from "./command-context";
import { copyActivityDraft, type CopyActivityDraftInput } from "./copy-activity-draft";
import { saveActivityDraft } from "./save-activity-draft";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-24T10:00:00Z");
const content = waterConservationTaskBookV3;
function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}
async function fixture() {
  const school = await db!.school.create({ data: { name: "复用测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "复用教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const student = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "STUDENT", displayName: "学生", schoolId: school.id } });
  const classroom = await db!.classroom.create({ data: { name: "复用班级", schoolId: school.id, managerId: teacher.id } });
  const draft = await saveActivityDraft(db!, context(teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content, idempotencyKey: randomUUID() });
  const input: CopyActivityDraftInput = { source: { kind: "DRAFT", id: draft.draftId, version: 1 }, title: "新学期副本", idempotencyKey: randomUUID() };
  return { school, teacher, other, student, classroom, draft, input };
}
async function assertNoCopy(input: CopyActivityDraftInput) {
  expect(await db!.idempotencyRecord.count({ where: { commandName: "copy_activity_draft", idempotencyKey: input.idempotencyKey } })).toBe(0);
  expect(await db!.actionAudit.count({ where: { actionName: "copy_activity_draft", idempotencyKey: input.idempotencyKey, outcome: "SUCCEEDED" } })).toBe(0);
}

suite("N1 exact-source activity copy", () => {
  afterAll(async () => db?.$disconnect());

  it("copies the exact revision, keeps origin after edits, and independently republishes", async () => {
    const f = await fixture();
    const preview = await getActivityCopyPreview(db!, context(f.teacher.id), f.input.source);
    expect(preview.content).toEqual(content);
    const result = await copyActivityDraft(db!, context(f.teacher.id), f.input);
    expect(result.draftId).not.toBe(f.draft.draftId);
    const stored = await db!.activityDraft.findUniqueOrThrow({ where: { id: result.draftId }, include: { revisions: true, origin: true, release: true } });
    expect(stored).toMatchObject({ status: "EDITING", version: 1, ownerId: f.teacher.id, sealedAt: null, release: null, taskBook: { ...content, title: f.input.title } });
    expect(stored.revisions).toHaveLength(1);
    expect(stored.revisions[0]).toMatchObject({ id: result.revisionId, version: 1, source: "MANUAL", agentRunId: null });
    expect(stored.origin).toMatchObject({ sourceRevisionId: f.draft.revisionId, sourceReleaseId: null });
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: result.draftId, expectedVersion: 1, desiredStatus: "READY_FOR_PREVIEW", content: { ...content, title: f.input.title, summary: "按新班级修改" }, idempotencyKey: randomUUID() });
    const release = await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, draft: { draftId: result.draftId, version: 2 } });
    expect(await db!.activityReleaseSnapshot.findUniqueOrThrow({ where: { releaseId: release.releaseId } })).toMatchObject({ content: { summary: "按新班级修改" } });
    expect(await db!.activityDraft.findUniqueOrThrow({ where: { id: f.draft.draftId } })).toMatchObject({ version: 1, taskBook: content });
    expect(await getActivityDraftOrigin(db!, context(f.teacher.id), result.draftId)).toEqual({ kind: "DRAFT", title: content.title, version: 1 });
    await expect(getActivityDraftOrigin(db!, context(f.other.id), result.draftId)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
  });

  it("copies frozen closed releases without their status, due date, or history and preserves the hash", async () => {
    const f = await fixture();
    const release = await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, dueAt: new Date(now.getTime() + 86400000), content });
    await closePublishedActivity(db!, { teacherId: f.teacher.id, releaseId: release.releaseId, closedAt: now });
    const before = await db!.activityReleaseSnapshot.findUniqueOrThrow({ where: { releaseId: release.releaseId } });
    const input: CopyActivityDraftInput = { ...f.input, source: { kind: "RELEASE", id: release.releaseId, version: 1 } };
    const copied = await copyActivityDraft(db!, context(f.teacher.id), input);
    expect(await db!.activityDraftOrigin.findUniqueOrThrow({ where: { draftId: copied.draftId } })).toMatchObject({ sourceRevisionId: null, sourceReleaseId: release.releaseId });
    expect(await db!.activityRelease.count({ where: { sourceDraftId: copied.draftId } })).toBe(0);
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: copied.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, title: "修改副本" }, idempotencyKey: randomUUID() });
    expect(await db!.activityReleaseSnapshot.findUniqueOrThrow({ where: { releaseId: release.releaseId } })).toEqual(before);
    // 新 key：让请求真正走到封存草稿的授权检查，而不是先撞上幂等冲突。
    await expect(copyActivityDraft(db!, context(f.teacher.id), { ...f.input, idempotencyKey: randomUUID(), source: { kind: "DRAFT", id: release.draftId, version: 1 } })).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
  });

  it("replays racing requests once and rejects changed title or source", async () => {
    const f = await fixture();
    const results = await Promise.all([copyActivityDraft(db!, context(f.teacher.id), f.input), copyActivityDraft(db!, context(f.teacher.id), f.input)]);
    expect(results[0]).toEqual(results[1]);
    expect(await db!.activityDraftOrigin.count({ where: { sourceRevisionId: f.draft.revisionId } })).toBe(1);
    expect(await db!.actionAudit.count({ where: { targetId: results[0].draftId, actionName: "copy_activity_draft", outcome: "SUCCEEDED" } })).toBe(1);
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "来源已更新" }, idempotencyKey: randomUUID() });
    expect(await copyActivityDraft(db!, context(f.teacher.id), f.input)).toEqual(results[0]);
    await expect(copyActivityDraft(db!, context(f.teacher.id), { ...f.input, title: "换标题" })).rejects.toEqual(new ActivityCopyError("IDEMPOTENCY_MISMATCH"));
    await expect(copyActivityDraft(db!, context(f.teacher.id), { ...f.input, source: { ...f.input.source, version: 2 } })).rejects.toEqual(new ActivityCopyError("IDEMPOTENCY_MISMATCH"));
  });

  it("rejects stale previews and client-supplied replacement content with zero new draft", async () => {
    const f = await fixture();
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, title: "新版本" }, idempotencyKey: randomUUID() });
    await expect(getActivityCopyPreview(db!, context(f.teacher.id), f.input.source)).rejects.toEqual(new ActivityCopyError("STALE_VERSION"));
    await expect(copyActivityDraft(db!, context(f.teacher.id), f.input)).rejects.toEqual(new ActivityCopyError("STALE_VERSION"));
    const tampered = { ...f.input, content };
    await expect(copyActivityDraft(db!, context(f.teacher.id), tampered)).rejects.toMatchObject({ name: "ZodError" });
    await assertNoCopy(f.input);
    expect(await db!.activityDraft.count({ where: { ownerId: f.teacher.id } })).toBe(1);
  });

  it("denies other teachers, students, absent sources, disabled accounts and disabled schools", async () => {
    const f = await fixture();
    for (const actorId of [f.other.id, f.student.id]) {
      await expect(copyActivityDraft(db!, context(actorId), f.input)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
      await expect(getActivityCopyPreview(db!, context(actorId), f.input.source)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
    }
    await expect(copyActivityDraft(db!, context(f.teacher.id), { ...f.input, source: { ...f.input.source, id: randomUUID() } })).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
    await expect(copyActivityDraft(db!, { ...context(f.teacher.id), source: "AGENT" }, f.input)).rejects.toBeInstanceOf(TypeError);
    await db!.appUser.update({ where: { id: f.teacher.id }, data: { accountStatus: "DISABLED" } });
    await expect(copyActivityDraft(db!, context(f.teacher.id), f.input)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
    await db!.appUser.update({ where: { id: f.teacher.id }, data: { accountStatus: "ACTIVE" } });
    await db!.school.update({ where: { id: f.school.id }, data: { status: "DISABLED" } });
    await expect(copyActivityDraft(db!, context(f.teacher.id), f.input)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
    await assertNoCopy(f.input);
  });

  it("rechecks release authority on preview, creation, and replay, and permits restored authority", async () => {
    const f = await fixture();
    const release = await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, content });
    const input: CopyActivityDraftInput = { ...f.input, source: { kind: "RELEASE", id: release.releaseId, version: 1 } };
    const result = await copyActivityDraft(db!, context(f.teacher.id), input);
    await db!.classroom.update({ where: { id: f.classroom.id }, data: { managerId: f.other.id } });
    for (const id of [f.teacher.id, f.other.id]) {
      await expect(getActivityCopyPreview(db!, context(id), input.source)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
      await expect(copyActivityDraft(db!, context(id), { ...input, idempotencyKey: randomUUID() })).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
    }
    await expect(copyActivityDraft(db!, context(f.teacher.id), input)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
    expect((await getActivityCopySources(db!, context(f.teacher.id))).releases).toHaveLength(0);
    expect(await getActivityDraftOrigin(db!, context(f.teacher.id), result.draftId)).toMatchObject({ kind: "RELEASE", title: content.title, version: 1 });
    await db!.classroom.update({ where: { id: f.classroom.id }, data: { managerId: f.teacher.id } });
    expect(await copyActivityDraft(db!, context(f.teacher.id), input)).toEqual(result);
    await db!.appUser.update({ where: { id: f.teacher.id }, data: { accountStatus: "DISABLED" } });
    await expect(copyActivityDraft(db!, context(f.teacher.id), input)).rejects.toEqual(new ActivityCopyError("NOT_FOUND"));
  });

  it("keeps v1 and v2 sources out of reuse without converting history", async () => {
    const f = await fixture();
    const legacy = await db!.activityDraft.create({ data: { ownerId: f.teacher.id, ...waterConservationActivity, revisions: { create: { version: 1, source: "MANUAL", ...waterConservationActivity } } } });
    const v2 = await saveActivityDraft(db!, context(f.teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content: waterConservationTaskBook, idempotencyKey: randomUUID() });
    for (const id of [legacy.id, v2.draftId]) {
      const source = { kind: "DRAFT" as const, id, version: 1 };
      await expect(copyActivityDraft(db!, context(f.teacher.id), { ...f.input, source })).rejects.toEqual(new ActivityCopyError("UNSUPPORTED_SCHEMA"));
    }
    const sources = await getActivityCopySources(db!, context(f.teacher.id));
    expect(sources.drafts.map((d) => d.id)).toEqual([f.draft.draftId]);
    const oldRelease = await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, content: waterConservationTaskBook });
    await expect(copyActivityDraft(db!, context(f.teacher.id), { ...f.input, source: { kind: "RELEASE", id: oldRelease.releaseId, version: 1 } })).rejects.toEqual(new ActivityCopyError("UNSUPPORTED_SCHEMA"));
  });

  it("protects origin rows and rejects a source whose body differs from the initial copy", async () => {
    const f = await fixture();
    const result = await copyActivityDraft(db!, context(f.teacher.id), f.input);
    await expect(db!.activityDraftOrigin.delete({ where: { draftId: result.draftId } })).rejects.toThrow();
    await expect(db!.activityDraftOrigin.update({ where: { draftId: result.draftId }, data: { sourceRevisionId: f.draft.revisionId } })).rejects.toThrow();
    const unrelated = await saveActivityDraft(db!, context(f.teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content: { ...content, summary: "不是来源的内容" }, idempotencyKey: randomUUID() });
    await expect(db!.activityDraftOrigin.create({ data: { draftId: unrelated.draftId, sourceRevisionId: f.draft.revisionId, createdAt: now } })).rejects.toThrow();
    await expect(db!.activityDraftOrigin.create({ data: { draftId: unrelated.draftId, createdAt: now } })).rejects.toThrow();
  });

  it("rolls back the draft and revision when origin persistence fails", async () => {
    const f = await fixture();
    const broken = db!.$extends({ query: { activityDraftOrigin: { async create() { throw new Error("synthetic origin failure"); } } } }) as unknown as PrismaClient;
    await expect(copyActivityDraft(broken, context(f.teacher.id), f.input)).rejects.toThrow("synthetic origin failure");
    expect(await db!.activityDraft.count({ where: { ownerId: f.teacher.id } })).toBe(1);
    expect(await db!.activityDraftRevision.count({ where: { draft: { ownerId: f.teacher.id } } })).toBe(1);
    await assertNoCopy(f.input);
    expect((await copyActivityDraft(db!, context(f.teacher.id), f.input)).version).toBe(1);
  });

  it("serializes a racing source edit without copying a different revision", async () => {
    const f = await fixture();
    const [copy, edit] = await Promise.allSettled([
      copyActivityDraft(db!, context(f.teacher.id), f.input),
      saveActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "并发修改" }, idempotencyKey: randomUUID() }),
    ]);
    expect(edit.status).toBe("fulfilled");
    if (copy.status === "fulfilled") {
      expect(await db!.activityDraft.findUniqueOrThrow({ where: { id: copy.value.draftId } })).toMatchObject({ taskBook: { ...content, title: f.input.title } });
    } else {
      expect(copy.reason).toBeInstanceOf(ActivityCopyError);
      expect(["STALE_VERSION", "CONCURRENT_WRITE"]).toContain(copy.reason.code);
      await assertNoCopy(f.input);
    }
  });
});
