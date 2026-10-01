import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import {
  diagnoseActivityDraft,
  type ActivityDraftDiagnosisDependencies,
  type DiagnosisModelInput,
} from "../assistant/activity-draft-diagnosis";
import { finishActivityAssistantRun, startActivityAssistantRun } from "../assistant/agent-run-lifecycle";
import { createDatabaseClient } from "../db/client";
import { getActivitySourceReferences } from "../queries/activity-source-references";
import {
  getDraftOriginSignals,
  getReleaseTaskBookSignals,
} from "../queries/release-task-book-signals";
import { getTeacherActivityDraft } from "../queries/teacher-activity-workspace";
import type { CommandContext } from "./command-context";
import { copyActivityDraft } from "./copy-activity-draft";
import { recordActivityDraftDiagnosis } from "./record-activity-draft-diagnosis";
import { saveActivityDraft } from "./save-activity-draft";
import { saveSubmissionWorkingCopy } from "./save-submission-working-copy";
import { submitSubmissionRevision } from "./submit-submission-revision";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
// Past instants: the database refuses a draft whose update time moves backwards
// relative to the wall clock it stamps on publish.
const now = new Date("2026-09-30T03:00:00Z");
const content = { ...waterConservationTaskBookV3, submissionMode: "phased" as const };

const later = new Date("2026-09-30T05:00:00Z");

function context(actorId: string, at = later): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => at };
}

async function fixture() {
  const school = await db!.school.create({ data: { name: "信号测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "信号教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const classroom = await db!.classroom.create({ data: { name: "信号班级", schoolId: school.id, managerId: teacher.id } });
  const source = await saveActivityDraft(db!, context(teacher.id, now), { draftId: null, expectedVersion: null, desiredStatus: "READY_FOR_PREVIEW", content, idempotencyKey: randomUUID() });
  const release = await createPublishedActivity(db!, { teacherId: teacher.id, classroomId: classroom.id, publishedAt: now, draft: source });
  // Three students hand in phase 1 with text but leave its one evidence item
  // unticked: the pattern that points at the task book.
  for (const [index, name] of ["陈同学", "李明", "王芳"].entries()) {
    const student = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "STUDENT", displayName: name, schoolId: school.id, studentNo: `${Date.now()}${index}`.slice(-10) } });
    await db!.classroomMembership.create({ data: { classroomId: classroom.id, studentId: student.id, joinedAt: new Date("2026-09-29T00:00:00Z") } });
    const saved = await saveSubmissionWorkingCopy(db!, context(student.id), { releaseId: release.releaseId, phaseIndex: 1, expectedWorkingCopyId: null, expectedWorkingVersion: null, textEvidence: `${name}的观察记录。`, completedEvidenceIndexes: [], idempotencyKey: `signal_save_${randomUUID()}` });
    await submitSubmissionRevision(db!, context(student.id), { releaseId: release.releaseId, phaseIndex: 1, expectedWorkingCopyId: saved.workingCopyId, expectedWorkingVersion: saved.workingVersion, idempotencyKey: `signal_submit_${randomUUID()}` });
  }
  const copy = await copyActivityDraft(db!, context(teacher.id), { source: { kind: "RELEASE", id: release.releaseId, version: source.version }, title: "节水行动（第二轮）", idempotencyKey: `signal_copy_${randomUUID()}` });
  return { teacher, other, classroom, releaseId: release.releaseId, copyDraftId: copy.draftId };
}

suite("D-088 task-book signals", () => {
  afterAll(async () => db?.$disconnect());

  it("carries a release's signals onto its copy and marks edited fields", async () => {
    const f = await fixture();
    const release = await getReleaseTaskBookSignals(db!, context(f.teacher.id), f.releaseId);
    expect(release?.copySource).toEqual({ id: f.releaseId, version: 1 });
    expect(release?.signals).toEqual([
      {
        target: "phases.1.evidence.1",
        kind: "EVIDENCE_SKIPPED",
        sourceLabel: "阶段 1 · 证据 1",
        text: "已交的 3 份里有 3 份没有勾选这项证据。",
      },
    ]);

    const carried = await getDraftOriginSignals(db!, context(f.teacher.id), f.copyDraftId);
    expect(carried?.signals.map((signal) => [signal.target, signal.state])).toEqual([
      ["phases.1.evidence.1", "unchanged"],
    ]);

    // The teacher rewrites that evidence requirement in the copy.
    await saveActivityDraft(db!, context(f.teacher.id), {
      draftId: f.copyDraftId,
      expectedVersion: 1,
      desiredStatus: "EDITING",
      content: {
        ...content,
        title: "节水行动（第二轮）",
        phases: content.phases.map((phase, index) =>
          index === 0
            ? { ...phase, evidence: [{ ...phase.evidence[0]!, description: "一段 80 字以上的现场观察，写明时间和地点" }] }
            : phase,
        ),
      },
      idempotencyKey: randomUUID(),
    });
    const afterEdit = await getDraftOriginSignals(db!, context(f.teacher.id), f.copyDraftId);
    expect(afterEdit?.signals[0]).toMatchObject({ state: "changed", sourceLabel: "阶段 1 · 证据 1" });

    // The version check is told, and told that the field has been edited.
    let seen: DiagnosisModelInput | null = null;
    const dependencies: ActivityDraftDiagnosisDependencies = {
      getConfig: () => ({ model: "fake-diagnosis-model" }) as never,
      createModel: () => ({}) as LanguageModel,
      getDraft: getTeacherActivityDraft,
      getSources: getActivitySourceReferences,
      getSignals: getDraftOriginSignals,
      startRun: startActivityAssistantRun,
      finishRun: finishActivityAssistantRun,
      recordDiagnosis: recordActivityDraftDiagnosis,
      generateDiagnosis: async (_model, input) => {
        seen = input;
        return { summary: "证据要求已经改得更具体。", findings: [] };
      },
    };
    await diagnoseActivityDraft(db!, context(f.teacher.id), { draftId: f.copyDraftId, expectedVersion: 2 }, dependencies);
    expect(seen!.classroomSignals).toEqual([
      { target: "phases.1.evidence.1", signal: "已交的 3 份里有 3 份没有勾选这项证据。", editedSince: true },
    ]);
  });

  it("shows nothing once the teacher no longer manages the source classroom", async () => {
    const f = await fixture();
    expect(await getReleaseTaskBookSignals(db!, context(f.other.id), f.releaseId)).toBeNull();
    expect(await getDraftOriginSignals(db!, context(f.other.id), f.copyDraftId)).toBeNull();

    await db!.classroom.update({ where: { id: f.classroom.id }, data: { managerId: f.other.id } });
    // The copy is still the teacher's; the classroom data behind it is not.
    expect(await getDraftOriginSignals(db!, context(f.teacher.id), f.copyDraftId)).toBeNull();
    expect((await getTeacherActivityDraft(db!, context(f.teacher.id), { draftId: f.copyDraftId })).draft.id).toBe(f.copyDraftId);
  });

  it("has nothing to carry for a draft that was not copied from a release", async () => {
    const f = await fixture();
    const fresh = await saveActivityDraft(db!, context(f.teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content, idempotencyKey: randomUUID() });
    expect(await getDraftOriginSignals(db!, context(f.teacher.id), fresh.draftId)).toBeNull();
  });
});
