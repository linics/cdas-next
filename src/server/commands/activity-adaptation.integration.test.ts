import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { adaptationModelSource, type ActivityAdaptationRequest } from "../../domain/activity/activity-adaptation";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import type { PrismaClient } from "../../generated/prisma/client";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import {
  ActivityAdaptationSuggestionError,
  discardActivityAdaptation,
  suggestActivityAdaptation,
  type ActivityAdaptationSuggestionDependencies,
} from "../assistant/activity-adaptation-suggestion";
import { finishActivityAssistantRun, startActivityAssistantRun } from "../assistant/agent-run-lifecycle";
import { createDatabaseClient } from "../db/client";
import { getTeacherActivityDraft } from "../queries/teacher-activity-workspace";
import { ApplyActivityAdaptationError, applyActivityAdaptation } from "./apply-activity-adaptation";
import type { CommandContext } from "./command-context";
import { recordActivityAdaptationSuggestion } from "./record-activity-adaptation-suggestion";
import { saveActivityDraft } from "./save-activity-draft";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-20T10:00:00Z");
const content = waterConservationTaskBookV3;

function context(actorId: string): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => now };
}

/** The model is the only fake: authorization, runs, audits and history are real. */
function dependencies(
  generateAdaptation: ActivityAdaptationSuggestionDependencies["generateAdaptation"],
): ActivityAdaptationSuggestionDependencies {
  return {
    getConfig: () => ({ model: "fake-adaptation-model" }) as never,
    createModel: () => ({}) as LanguageModel,
    getDraft: getTeacherActivityDraft,
    startRun: startActivityAssistantRun,
    finishRun: finishActivityAssistantRun,
    recordSuggestion: recordActivityAdaptationSuggestion,
    generateAdaptation,
  };
}

function rewrittenBackground() {
  return async () => ({
    BACKGROUND: { backgroundSetting: "社区希望根据八年级学生的调查改进公共用水。" },
  });
}

const request: ActivityAdaptationRequest = {
  targetGrade: 8,
  totalLessons: null,
  contextNote: "改为社区公共用水情境",
  areas: ["BACKGROUND"],
};

async function fixture() {
  const school = await db!.school.create({ data: { name: "适配测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "适配教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const classroom = await db!.classroom.create({ data: { name: "适配班级", schoolId: school.id, managerId: teacher.id } });
  const draft = await saveActivityDraft(db!, context(teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content, idempotencyKey: randomUUID() });
  return { teacher, other, classroom, draft };
}

async function suggest(
  database: PrismaClient,
  actorId: string,
  draftId: string,
  generate: ActivityAdaptationSuggestionDependencies["generateAdaptation"] = rewrittenBackground(),
  input: Partial<typeof request> = {},
) {
  return suggestActivityAdaptation(
    database,
    context(actorId),
    { draftId, expectedVersion: 1, request: { ...request, ...input } },
    dependencies(generate),
  );
}

suite("N1 AI adaptation", () => {
  afterAll(async () => db?.$disconnect());

  it("proposes without writing, then applies the exact proposal as one AGENT revision", async () => {
    const f = await fixture();
    const suggestion = await suggest(db!, f.teacher.id, f.draft.draftId);
    expect(suggestion.changes.map((change) => change.label)).toEqual(["年级", "背景设定"]);
    expect(await db!.activityDraft.findUniqueOrThrow({ where: { id: f.draft.draftId } })).toMatchObject({ version: 1, taskBook: content });
    expect(await db!.agentRun.findUniqueOrThrow({ where: { id: suggestion.agentRunId } })).toMatchObject({ status: "RUNNING" });

    const input = { draftId: f.draft.draftId, expectedVersion: 1, agentRunId: suggestion.agentRunId, content: suggestion.content, idempotencyKey: randomUUID() };
    const applied = await applyActivityAdaptation(db!, context(f.teacher.id), input);
    expect(applied.version).toBe(2);
    const stored = await db!.activityDraft.findUniqueOrThrow({ where: { id: f.draft.draftId }, include: { revisions: { orderBy: { version: "asc" } } } });
    expect(stored).toMatchObject({ version: 2, status: "READY_FOR_PREVIEW", taskBook: { grade: 8, backgroundSetting: "社区希望根据八年级学生的调查改进公共用水。", taskInstructions: content.taskInstructions } });
    expect(stored.revisions.map((revision) => [revision.version, revision.source, revision.agentRunId])).toEqual([
      [1, "MANUAL", null],
      [2, "AGENT", suggestion.agentRunId],
    ]);
    expect(stored.revisions[0]!.taskBook).toEqual(content);
    expect(await db!.agentRun.findUniqueOrThrow({ where: { id: suggestion.agentRunId } })).toMatchObject({ status: "SUCCEEDED", failureCode: null });

    expect(await applyActivityAdaptation(db!, context(f.teacher.id), input)).toEqual(applied);
    await expect(applyActivityAdaptation(db!, context(f.teacher.id), { ...input, idempotencyKey: randomUUID() })).rejects.toEqual(new ApplyActivityAdaptationError("ALREADY_APPLIED"));
    expect(await db!.activityDraftRevision.count({ where: { draftId: f.draft.draftId } })).toBe(2);
  });

  it("rejects content changed on the way back, another teacher, and a discarded proposal", async () => {
    const f = await fixture();
    const suggestion = await suggest(db!, f.teacher.id, f.draft.draftId);
    const input = { draftId: f.draft.draftId, expectedVersion: 1, agentRunId: suggestion.agentRunId, content: suggestion.content, idempotencyKey: randomUUID() };

    await expect(applyActivityAdaptation(db!, context(f.teacher.id), { ...input, content: { ...suggestion.content, taskInstructions: "客户端偷偷改写" } })).rejects.toEqual(new ApplyActivityAdaptationError("INVALID_SUGGESTION"));
    await expect(applyActivityAdaptation(db!, context(f.other.id), { ...input, idempotencyKey: randomUUID() })).rejects.toEqual(new ApplyActivityAdaptationError("NOT_FOUND"));
    await expect(suggest(db!, f.other.id, f.draft.draftId)).rejects.toEqual(new ActivityAdaptationSuggestionError("NOT_FOUND"));

    await discardActivityAdaptation(db!, context(f.teacher.id), suggestion.agentRunId);
    expect(await db!.agentRun.findUniqueOrThrow({ where: { id: suggestion.agentRunId } })).toMatchObject({ status: "CANCELLED", failureCode: "ADAPTATION_DISCARDED" });
    await expect(applyActivityAdaptation(db!, context(f.teacher.id), { ...input, idempotencyKey: randomUUID() })).rejects.toEqual(new ApplyActivityAdaptationError("INVALID_SUGGESTION"));
    expect(await db!.activityDraft.findUniqueOrThrow({ where: { id: f.draft.draftId } })).toMatchObject({ version: 1, taskBook: content });
  });

  it("refuses a proposal once the draft has moved, before or after the model answers", async () => {
    const f = await fixture();
    const suggestion = await suggest(db!, f.teacher.id, f.draft.draftId);
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "教师手工改过" }, idempotencyKey: randomUUID() });
    await expect(applyActivityAdaptation(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, agentRunId: suggestion.agentRunId, content: suggestion.content, idempotencyKey: randomUUID() })).rejects.toEqual(new ApplyActivityAdaptationError("STALE_VERSION"));
    expect(await db!.activityDraft.findUniqueOrThrow({ where: { id: f.draft.draftId } })).toMatchObject({ version: 2, taskBook: { summary: "教师手工改过", grade: 7 } });

    const g = await fixture();
    const racing = suggest(db!, g.teacher.id, g.draft.draftId, async () => {
      await saveActivityDraft(db!, context(g.teacher.id), { draftId: g.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "模型运行期间保存" }, idempotencyKey: randomUUID() });
      return rewrittenBackground()();
    });
    await expect(racing).rejects.toEqual(new ActivityAdaptationSuggestionError("STALE_VERSION"));
    const runs = await db!.agentRun.findMany({ where: { actorId: g.teacher.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "FAILED", failureCode: "ADAPTATION_STALE_DRAFT" });
  });

  it("fails structural rewrites and incompatible requests without a proposal", async () => {
    const f = await fixture();
    const dropped = async () => {
      const phases = adaptationModelSource(content, ["PHASES"]).PHASES!;
      phases.phases.pop();
      return { PHASES: phases };
    };
    await expect(suggest(db!, f.teacher.id, f.draft.draftId, dropped, { areas: ["PHASES"] })).rejects.toEqual(new ActivityAdaptationSuggestionError("INVALID_OUTPUT"));
    await expect(suggest(db!, f.teacher.id, f.draft.draftId, async () => ({ BACKGROUND: { backgroundSetting: "x" }, RUBRIC: {} }))).rejects.toEqual(new ActivityAdaptationSuggestionError("INVALID_OUTPUT"));
    const runs = await db!.agentRun.findMany({ where: { actorId: f.teacher.id }, orderBy: { failureCode: "asc" } });
    expect(runs.map((run) => [run.status, run.failureCode])).toEqual([
      ["FAILED", "ADAPTATION_INVALID_OUTPUT"],
      ["FAILED", "ADAPTATION_STRUCTURE_CHANGED"],
    ]);

    // Physics has no primary-school curriculum: no run is started at all.
    await expect(suggest(db!, f.teacher.id, f.draft.draftId, rewrittenBackground(), { targetGrade: 4 })).rejects.toEqual(new ActivityAdaptationSuggestionError("GRADE_INCOMPATIBLE"));
    expect(await db!.agentRun.count({ where: { actorId: f.teacher.id } })).toBe(2);
    expect(await db!.actionAudit.count({ where: { actorId: f.teacher.id, actionName: "suggest_activity_adaptation" } })).toBe(0);
  });

  it("leaves published drafts alone", async () => {
    const f = await fixture();
    const release = await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, content });
    await expect(
      suggestActivityAdaptation(db!, context(f.teacher.id), { draftId: release.draftId, expectedVersion: 1, request }, dependencies(rewrittenBackground())),
    ).rejects.toEqual(new ActivityAdaptationSuggestionError("NOT_ADAPTABLE"));
  });
});
