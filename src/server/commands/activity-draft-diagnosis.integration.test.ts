import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import {
  ActivityDraftDiagnosisError,
  diagnoseActivityDraft,
  type ActivityDraftDiagnosisDependencies,
} from "../assistant/activity-draft-diagnosis";
import { finishActivityAssistantRun, startActivityAssistantRun } from "../assistant/agent-run-lifecycle";
import { createDatabaseClient } from "../db/client";
import { getActivitySourceReferences } from "../queries/activity-source-references";
import { getDraftDiagnoses } from "../queries/activity-draft-diagnoses";
import { getTeacherActivityDraft } from "../queries/teacher-activity-workspace";
import type { CommandContext } from "./command-context";
import { recordActivityDraftDiagnosis } from "./record-activity-draft-diagnosis";
import { saveActivityDraft } from "./save-activity-draft";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-20T10:00:00Z");
const content = waterConservationTaskBookV3;

function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

const goodOutput = {
  summary: "结构完整，证据要求偏笼统。",
  findings: [
    { target: "phases.2.evidence.1", category: "EVIDENCE", problem: "「数据表与分析说明」看不出比较了什么。", suggestion: "要求至少两个点位的对比表和一句结论。" },
    { target: "rubricDimensions.2", category: "RUBRIC", problem: "四档只靠程度词区分。", suggestion: "给出数据条数与图表的可数锚点。" },
  ],
};

/** The model is the only fake; authorization, runs and history are real. */
function dependencies(
  generateDiagnosis: ActivityDraftDiagnosisDependencies["generateDiagnosis"],
): ActivityDraftDiagnosisDependencies {
  return {
    getConfig: () => ({ model: "fake-diagnosis-model" }) as never,
    createModel: () => ({}) as LanguageModel,
    getDraft: getTeacherActivityDraft,
    getSources: getActivitySourceReferences,
    startRun: startActivityAssistantRun,
    finishRun: finishActivityAssistantRun,
    recordDiagnosis: recordActivityDraftDiagnosis,
    generateDiagnosis,
  };
}

async function fixture() {
  const school = await db!.school.create({ data: { name: "诊断测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "诊断教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const classroom = await db!.classroom.create({ data: { name: "诊断班级", schoolId: school.id, managerId: teacher.id } });
  const draft = await saveActivityDraft(db!, context(teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "READY_FOR_PREVIEW", content, idempotencyKey: randomUUID() });
  return { teacher, other, classroom, draft };
}

suite("N4b version diagnosis", () => {
  afterAll(async () => db?.$disconnect());

  it("records a diagnosis for the exact revision and keeps it as history after edits", async () => {
    const f = await fixture();
    const result = await diagnoseActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1 }, dependencies(async () => goodOutput));
    expect(result.findings.map((finding) => finding.label)).toEqual(["阶段 2 · 证据 1", "评价维度 2「数据与证据」"]);

    const stored = await db!.activityDraftDiagnosis.findUniqueOrThrow({ where: { id: result.diagnosisId }, include: { agentRun: true, revision: true } });
    expect(stored.revision.version).toBe(1);
    expect(stored.agentRun.status).toBe("SUCCEEDED");
    expect(await db!.actionAudit.count({ where: { actionName: "diagnose_activity_draft", resultResourceId: result.diagnosisId, outcome: "SUCCEEDED" } })).toBe(1);
    // The task book itself is untouched.
    expect(await db!.activityDraft.findUniqueOrThrow({ where: { id: f.draft.draftId } })).toMatchObject({ version: 1, taskBook: content });

    await saveActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "按建议修改" }, idempotencyKey: randomUUID() });
    const view = await getDraftDiagnoses(db!, context(f.teacher.id), f.draft.draftId);
    expect(view?.map((diagnosis) => diagnosis.revisionVersion)).toEqual([1]);
    expect(await getDraftDiagnoses(db!, context(f.other.id), f.draft.draftId)).toBeNull();

    await expect(db!.activityDraftDiagnosis.update({ where: { id: result.diagnosisId }, data: { summary: "改写历史" } })).rejects.toThrow();
    await expect(db!.activityDraftDiagnosis.delete({ where: { id: result.diagnosisId } })).rejects.toThrow();
  });

  it("fails closed on unlocatable findings and on a draft that moved during the call", async () => {
    const f = await fixture();
    await expect(
      diagnoseActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1 }, dependencies(async () => ({ ...goodOutput, findings: [{ ...goodOutput.findings[0], target: "phases.9" }] }))),
    ).rejects.toEqual(new ActivityDraftDiagnosisError("INVALID_OUTPUT"));

    await expect(
      diagnoseActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1 }, dependencies(async () => {
        await saveActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "模型运行期间保存" }, idempotencyKey: randomUUID() });
        return goodOutput;
      })),
    ).rejects.toEqual(new ActivityDraftDiagnosisError("STALE_VERSION"));

    const runs = await db!.agentRun.findMany({ where: { actorId: f.teacher.id }, orderBy: { failureCode: "asc" } });
    expect(runs.map((run) => [run.status, run.failureCode])).toEqual([
      ["FAILED", "DIAGNOSIS_STALE_DRAFT"],
      ["FAILED", "DIAGNOSIS_UNKNOWN_TARGET"],
    ]);
    expect(await db!.activityDraftDiagnosis.count({ where: { draftId: f.draft.draftId } })).toBe(0);
  });

  it("refuses other teachers, stale versions and published drafts without starting a run", async () => {
    const f = await fixture();
    const fake = dependencies(async () => goodOutput);
    await expect(diagnoseActivityDraft(db!, context(f.other.id), { draftId: f.draft.draftId, expectedVersion: 1 }, fake)).rejects.toEqual(new ActivityDraftDiagnosisError("NOT_FOUND"));
    await expect(diagnoseActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 2 }, fake)).rejects.toEqual(new ActivityDraftDiagnosisError("STALE_VERSION"));
    await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, draft: f.draft });
    await expect(diagnoseActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1 }, fake)).rejects.toEqual(new ActivityDraftDiagnosisError("NOT_DIAGNOSABLE"));
    expect(await db!.agentRun.count({ where: { actorId: { in: [f.teacher.id, f.other.id] } } })).toBe(0);
  });
});
