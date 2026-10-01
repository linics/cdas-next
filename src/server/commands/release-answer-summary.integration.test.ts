import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import { generateSchoolCode } from "../../domain/school/identity";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import { finishActivityAssistantRun, startActivityAssistantRun } from "../assistant/agent-run-lifecycle";
import {
  ReleaseAnswerSummaryError,
  summarizeReleaseAnswers,
  type AnswerSummaryModelInput,
  type ReleaseAnswerSummaryDependencies,
} from "../assistant/release-answer-summary";
import { createDatabaseClient } from "../db/client";
import {
  getReleaseAnswerBasis,
  getReleaseAnswerSummaries,
} from "../queries/release-answer-summaries";
import type { CommandContext } from "./command-context";
import { recordReleaseAnswerSummary } from "./record-release-answer-summary";
import { saveSubmissionWorkingCopy } from "./save-submission-working-copy";
import { startSubmissionResubmission } from "./start-submission-resubmission";
import { submitSubmissionRevision } from "./submit-submission-revision";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-10-02T02:00:00Z");

function context(actorId: string, at = now): CommandContext {
  return { actorId, source: "UI", traceId: randomUUID(), clock: () => at };
}

const texts = [
  "二楼饮水机旁边在漏水，一分钟大约滴 40 滴。",
  "操场水龙头一直滴水，没有人管。",
  "厕所的水箱关不紧，一直在流。",
];

/** Quotes the first two answers as the model saw them, whatever their order. */
function groundedOutput(input: AnswerSummaryModelInput) {
  return {
    summary: "三份作答都指出了一处具体的漏水位置。",
    themes: [
      {
        kind: "STRENGTH",
        statement: "都写明了漏水的具体位置",
        evidence: input.answers.slice(0, 2).map((answer) => ({
          answer: answer.answer,
          quote: answer.text.slice(0, 8),
        })),
      },
    ],
  };
}

/** The model is the only fake; authorization, runs and history are real. */
function dependencies(
  generateSummary: (input: AnswerSummaryModelInput) => Promise<unknown>,
): ReleaseAnswerSummaryDependencies {
  return {
    getConfig: () => ({ model: "fake-answer-summary-model" }) as never,
    createModel: () => ({}) as LanguageModel,
    getBasis: getReleaseAnswerBasis,
    startRun: startActivityAssistantRun,
    finishRun: finishActivityAssistantRun,
    recordSummary: recordReleaseAnswerSummary,
    generateSummary: (_model, input) => generateSummary(input),
  };
}

async function submit(studentId: string, releaseId: string, text: string, at: Date) {
  const saved = await saveSubmissionWorkingCopy(db!, context(studentId, at), {
    releaseId,
    expectedWorkingCopyId: null,
    expectedWorkingVersion: null,
    textEvidence: text,
    idempotencyKey: `summary_save_${randomUUID()}`,
  });
  return submitSubmissionRevision(db!, context(studentId, at), {
    releaseId,
    expectedWorkingCopyId: saved.workingCopyId,
    expectedWorkingVersion: saved.workingVersion,
    idempotencyKey: `summary_submit_${randomUUID()}`,
  });
}

async function fixture(answerCount = 3) {
  const school = await db!.school.create({ data: { name: "归纳测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "归纳教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const classroom = await db!.classroom.create({ data: { name: "归纳班级", schoolId: school.id, managerId: teacher.id } });
  const students = [];
  for (const [index, name] of ["陈同学", "李明", "王芳"].entries()) {
    const student = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "STUDENT", displayName: name, schoolId: school.id, studentNo: `${Date.now()}${index}`.slice(-10) } });
    await db!.classroomMembership.create({ data: { classroomId: classroom.id, studentId: student.id, joinedAt: new Date("2026-10-01T00:00:00Z") } });
    students.push(student);
  }
  const release = await createPublishedActivity(db!, { teacherId: teacher.id, classroomId: classroom.id, publishedAt: new Date("2026-10-01T01:00:00Z") });
  for (const [index, student] of students.slice(0, answerCount).entries()) {
    await submit(student.id, release.releaseId, texts[index]!, new Date(now.getTime() - (index + 1) * 60_000));
  }
  return { teacher, other, students, releaseId: release.releaseId };
}

suite("D-086 answer summaries", () => {
  afterAll(async () => db?.$disconnect());

  it("stores a grounded summary with its basis and shows it with names", async () => {
    const f = await fixture();
    let seen: AnswerSummaryModelInput | null = null;
    const result = await summarizeReleaseAnswers(
      db!,
      context(f.teacher.id),
      { releaseId: f.releaseId, phaseIndex: 0 },
      dependencies(async (input) => {
        seen = input;
        return groundedOutput(input);
      }),
    );
    // The model is given numbered text and no names.
    expect(seen!.answers.map((answer) => answer.answer)).toEqual([1, 2, 3]);
    expect(JSON.stringify(seen)).not.toMatch(/陈同学|李明|王芳/);

    const stored = await db!.releaseAnswerSummary.findUniqueOrThrow({ where: { id: result.summaryId }, include: { agentRun: true } });
    expect(stored.basisRevisionIds).toHaveLength(3);
    expect(stored.agentRun.status).toBe("SUCCEEDED");
    expect(await db!.actionAudit.count({ where: { actionName: "summarize_release_answers", resultResourceId: result.summaryId, outcome: "SUCCEEDED" } })).toBe(1);

    const view = await getReleaseAnswerSummaries(db!, context(f.teacher.id), f.releaseId);
    expect(view).toHaveLength(1);
    expect(view![0]).toMatchObject({ phaseIndex: 0, answerCount: 3, canSummarize: true });
    expect(view![0]!.latest).toMatchObject({ basisCount: 3, changedSinceCount: 0 });
    expect(view![0]!.latest!.themes[0]!.sources.map((source) => source.audienceName).sort()).toEqual(["陈同学", "李明"].sort());
    expect(await getReleaseAnswerSummaries(db!, context(f.other.id), f.releaseId)).toBeNull();

    // History is append-only.
    await expect(db!.releaseAnswerSummary.update({ where: { id: result.summaryId }, data: { summary: "改写历史" } })).rejects.toThrow();
    await expect(db!.releaseAnswerSummary.delete({ where: { id: result.summaryId } })).rejects.toThrow();

    // A resubmission afterwards is reported as not included.
    const restarted = await startSubmissionResubmission(db!, context(f.students[0]!.id), { releaseId: f.releaseId, expectedLatestRevisionNumber: 1, idempotencyKey: `summary_restart_${randomUUID()}` });
    const saved = await saveSubmissionWorkingCopy(db!, context(f.students[0]!.id), { releaseId: f.releaseId, expectedWorkingCopyId: restarted.workingCopyId, expectedWorkingVersion: restarted.workingVersion, textEvidence: "补充：每天大约浪费 5 升水。", idempotencyKey: `summary_save_${randomUUID()}` });
    await submitSubmissionRevision(db!, context(f.students[0]!.id), { releaseId: f.releaseId, expectedWorkingCopyId: saved.workingCopyId, expectedWorkingVersion: saved.workingVersion, idempotencyKey: `summary_submit_${randomUUID()}` });
    const after = await getReleaseAnswerSummaries(db!, context(f.teacher.id), f.releaseId);
    expect(after![0]!.latest).toMatchObject({ basisCount: 3, changedSinceCount: 1 });
  });

  it("fails closed on ungrounded themes and on answers that changed during the call", async () => {
    const f = await fixture();
    await expect(
      summarizeReleaseAnswers(db!, context(f.teacher.id), { releaseId: f.releaseId, phaseIndex: 0 }, dependencies(async () => ({
        summary: "学生普遍缺乏数据意识。",
        themes: [{ kind: "GAP", statement: "观察不够细致", evidence: [{ answer: 1, quote: "观察不够细致深入" }, { answer: 2, quote: "没有体现数据意识" }] }],
      }))),
    ).rejects.toEqual(new ReleaseAnswerSummaryError("INVALID_OUTPUT"));

    await expect(
      summarizeReleaseAnswers(db!, context(f.teacher.id), { releaseId: f.releaseId, phaseIndex: 0 }, dependencies(async (input) => {
        const student = f.students[0]!;
        const restarted = await startSubmissionResubmission(db!, context(student.id), { releaseId: f.releaseId, expectedLatestRevisionNumber: 1, idempotencyKey: `summary_restart_${randomUUID()}` });
        const saved = await saveSubmissionWorkingCopy(db!, context(student.id), { releaseId: f.releaseId, expectedWorkingCopyId: restarted.workingCopyId, expectedWorkingVersion: restarted.workingVersion, textEvidence: "模型运行期间重交的作答。", idempotencyKey: `summary_save_${randomUUID()}` });
        await submitSubmissionRevision(db!, context(student.id), { releaseId: f.releaseId, expectedWorkingCopyId: saved.workingCopyId, expectedWorkingVersion: saved.workingVersion, idempotencyKey: `summary_submit_${randomUUID()}` });
        return groundedOutput(input);
      })),
    ).rejects.toEqual(new ReleaseAnswerSummaryError("STALE_ANSWERS"));

    const runs = await db!.agentRun.findMany({ where: { actorId: f.teacher.id }, orderBy: { failureCode: "asc" } });
    expect(runs.map((run) => [run.status, run.failureCode])).toEqual([
      ["FAILED", "ANSWER_SUMMARY_STALE_ANSWERS"],
      ["FAILED", "ANSWER_SUMMARY_UNGROUNDED"],
    ]);
    expect(await db!.releaseAnswerSummary.count({ where: { releaseId: f.releaseId } })).toBe(0);
  });

  it("refuses other teachers, unknown phases and too few answers without starting a run", async () => {
    const f = await fixture(2);
    const fake = dependencies(async (input) => groundedOutput(input));
    await expect(summarizeReleaseAnswers(db!, context(f.other.id), { releaseId: f.releaseId, phaseIndex: 0 }, fake)).rejects.toEqual(new ReleaseAnswerSummaryError("NOT_FOUND"));
    await expect(summarizeReleaseAnswers(db!, context(f.teacher.id), { releaseId: f.releaseId, phaseIndex: 2 }, fake)).rejects.toEqual(new ReleaseAnswerSummaryError("NOT_FOUND"));
    await expect(summarizeReleaseAnswers(db!, context(f.teacher.id), { releaseId: f.releaseId, phaseIndex: 0 }, fake)).rejects.toEqual(new ReleaseAnswerSummaryError("TOO_FEW_ANSWERS"));
    expect(await db!.agentRun.count({ where: { actorId: { in: [f.teacher.id, f.other.id] } } })).toBe(0);
  });

  it("rejects a record whose basis is not this release's revisions", async () => {
    const f = await fixture();
    const elsewhere = await fixture();
    const basis = await getReleaseAnswerBasis(db!, context(f.teacher.id), { releaseId: f.releaseId, phaseIndex: 0 });
    const foreign = await getReleaseAnswerBasis(db!, context(elsewhere.teacher.id), { releaseId: elsewhere.releaseId, phaseIndex: 0 });
    const run = await startActivityAssistantRun(db!, context(f.teacher.id), { model: "fake-answer-summary-model" });
    // Straight to the table, past the command: the database guard still holds.
    await expect(
      db!.releaseAnswerSummary.create({
        data: { releaseId: f.releaseId, phaseIndex: 0, agentRunId: run.id, requestedById: f.teacher.id, summary: "越界的依据", themes: [], basisRevisionIds: [basis!.answers[0]!.revisionId, basis!.answers[1]!.revisionId, foreign!.answers[0]!.revisionId] },
      }),
    ).rejects.toThrow();
    await expect(
      db!.releaseAnswerSummary.create({
        data: { releaseId: f.releaseId, phaseIndex: 0, agentRunId: run.id, requestedById: f.other.id, summary: "不是发布者", themes: [], basisRevisionIds: basis!.answers.map((answer) => answer.revisionId) },
      }),
    ).rejects.toThrow();
  });
});
