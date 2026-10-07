import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { emptyActivityDraftV3Values } from "../../app/teacher/activities/activity-draft-v3-state";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { createDatabaseClient } from "../db/client";
import {
  getOwnDraftWorkingCopy,
  getOwnNewTaskBookWorkingCopy,
  listOwnTaskBookWorkingCopies,
} from "../queries/activity-draft-working-copy";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import {
  ActivityDraftWorkingCopyError,
  discardActivityDraftWorkingCopy,
  saveActivityDraftWorkingCopy,
} from "./activity-draft-working-copy";
import type { CommandContext } from "./command-context";
import { saveActivityDraft } from "./save-activity-draft";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-10-07T10:00:00Z");

function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

async function fixture() {
  const school = await db!.school.create({
    data: { name: "工作稿测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) },
  });
  const teacher = await db!.appUser.create({
    data: { authSubject: randomUUID(), role: "TEACHER", displayName: "工作稿教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` },
  });
  const other = await db!.appUser.create({
    data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` },
  });
  const student = await db!.appUser.create({
    data: { authSubject: randomUUID(), role: "STUDENT", displayName: "学生", schoolId: school.id },
  });
  return { school, teacher, other, student };
}

const halfDone = { ...emptyActivityDraftV3Values, title: "写了一半的任务书", topic: "校园用水" };

suite("task-book working copies (D-093)", () => {
  afterAll(async () => db?.$disconnect());

  it("autosaves an incomplete new task book, then updates it in place", async () => {
    const f = await fixture();
    const created = await saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
      workingCopyId: null,
      draftId: null,
      expectedVersion: null,
      content: halfDone,
    });
    expect(created).toMatchObject({ draftId: null, version: 1 });

    const updated = await saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
      workingCopyId: created.workingCopyId,
      draftId: null,
      expectedVersion: 1,
      content: { ...halfDone, summary: "又写了一句" },
    });
    expect(updated).toMatchObject({ workingCopyId: created.workingCopyId, version: 2 });

    const read = await getOwnNewTaskBookWorkingCopy(db!, context(f.teacher.id), created.workingCopyId);
    expect(read).toMatchObject({ version: 2, baseVersion: 0, content: { summary: "又写了一句" } });
    expect(await getOwnNewTaskBookWorkingCopy(db!, context(f.other.id), created.workingCopyId)).toBeNull();

    const listed = await listOwnTaskBookWorkingCopies(db!, context(f.teacher.id));
    expect(listed).toEqual([
      expect.objectContaining({ id: created.workingCopyId, title: "写了一半的任务书", draftId: null }),
    ]);
    expect(listed[0]!.gapCount).toBeGreaterThan(10);
    // Nothing is a draft yet: preview, publish and the assistant see nothing.
    expect(await db!.activityDraft.count({ where: { ownerId: f.teacher.id } })).toBe(0);
  });

  it("refuses a stale tab but treats a retried save of the same content as saved", async () => {
    const f = await fixture();
    const created = await saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
      workingCopyId: null, draftId: null, expectedVersion: null, content: halfDone,
    });
    const next = { ...halfDone, summary: "第二次" };
    const first = await saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
      workingCopyId: created.workingCopyId, draftId: null, expectedVersion: 1, content: next,
    });
    const retried = await saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
      workingCopyId: created.workingCopyId, draftId: null, expectedVersion: 1, content: next,
    });
    expect(retried).toEqual(first);

    await expect(
      saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
        workingCopyId: created.workingCopyId, draftId: null, expectedVersion: 1, content: { ...halfDone, summary: "旧标签页" },
      }),
    ).rejects.toEqual(new ActivityDraftWorkingCopyError("STALE_VERSION"));
  });

  it("keeps a working copy per draft, based on the saved version", async () => {
    const f = await fixture();
    const draft = await saveActivityDraft(db!, context(f.teacher.id), {
      draftId: null, expectedVersion: null, desiredStatus: "EDITING", content: waterConservationTaskBookV3, idempotencyKey: randomUUID(),
    });
    const edited = { ...waterConservationTaskBookV3, taskInstructions: "" };
    const saved = await saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
      workingCopyId: null, draftId: draft.draftId, expectedVersion: null, content: edited,
    });
    expect(await getOwnDraftWorkingCopy(db!, context(f.teacher.id), draft.draftId)).toMatchObject({
      id: saved.workingCopyId, draftId: draft.draftId, baseVersion: 1, content: { taskInstructions: "" },
    });
    // The saved version is untouched until a complete version is saved.
    expect(await db!.activityDraft.findUniqueOrThrow({ where: { id: draft.draftId } })).toMatchObject({
      version: 1, taskBook: waterConservationTaskBookV3,
    });

    await expect(
      saveActivityDraftWorkingCopy(db!, context(f.other.id), {
        workingCopyId: null, draftId: draft.draftId, expectedVersion: null, content: edited,
      }),
    ).rejects.toEqual(new ActivityDraftWorkingCopyError("NOT_FOUND"));
    await expect(
      saveActivityDraftWorkingCopy(db!, context(f.student.id), {
        workingCopyId: null, draftId: null, expectedVersion: null, content: halfDone,
      }),
    ).rejects.toEqual(new ActivityDraftWorkingCopyError("FORBIDDEN"));

    await expect(
      discardActivityDraftWorkingCopy(db!, context(f.teacher.id), { workingCopyId: saved.workingCopyId, expectedVersion: 99 }),
    ).resolves.toEqual({ discarded: false });
    await expect(
      discardActivityDraftWorkingCopy(db!, context(f.teacher.id), { workingCopyId: saved.workingCopyId, expectedVersion: 1 }),
    ).resolves.toEqual({ discarded: true });
    expect(await getOwnDraftWorkingCopy(db!, context(f.teacher.id), draft.draftId)).toBeNull();
    // A tab still holding the discarded copy cannot quietly bring it back.
    await expect(
      saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
        workingCopyId: saved.workingCopyId, draftId: draft.draftId, expectedVersion: 1, content: edited,
      }),
    ).rejects.toEqual(new ActivityDraftWorkingCopyError("STALE_VERSION"));
  });

  it("does not open a working copy on a sealed draft or accept a malformed one", async () => {
    const f = await fixture();
    const classroom = await db!.classroom.create({ data: { name: "工作稿班级", schoolId: f.school.id, managerId: f.teacher.id } });
    const draft = await saveActivityDraft(db!, context(f.teacher.id), {
      draftId: null, expectedVersion: null, desiredStatus: "READY_FOR_PREVIEW", content: waterConservationTaskBookV3, idempotencyKey: randomUUID(),
    });
    await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: classroom.id, publishedAt: now, draft: { draftId: draft.draftId, version: draft.version } });
    await expect(
      saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
        workingCopyId: null, draftId: draft.draftId, expectedVersion: null, content: waterConservationTaskBookV3,
      }),
    ).rejects.toEqual(new ActivityDraftWorkingCopyError("DRAFT_SEALED"));
    await expect(
      saveActivityDraftWorkingCopy(db!, context(f.teacher.id), {
        workingCopyId: null, draftId: null, expectedVersion: null, content: { ...halfDone, phases: "三个阶段" },
      }),
    ).rejects.toEqual(new ActivityDraftWorkingCopyError("INVALID_CONTENT"));
  });
});
