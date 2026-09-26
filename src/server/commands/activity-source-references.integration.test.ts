import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { generateSchoolCode } from "../../domain/school/identity";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { createPublishedActivity } from "../../test/fixtures/published-activity";
import { startActivityAssistantRun } from "../assistant/agent-run-lifecycle";
import { createDatabaseClient } from "../db/client";
import { searchOfficialKnowledge } from "../knowledge/official-corpus";
import { getActivitySourceReferences } from "../queries/activity-source-references";
import {
  ActivitySourceReferenceError,
  adoptActivitySource,
  withdrawActivitySource,
} from "./activity-source-references";
import type { CommandContext } from "./command-context";
import { saveActivityDraft, SaveActivityDraftError } from "./save-activity-draft";

const databaseUrl = process.env.TEST_DATABASE_URL;
const db = databaseUrl ? createDatabaseClient(databaseUrl) : null;
const suite = databaseUrl ? describe : describe.skip;
const now = new Date("2026-09-20T10:00:00Z");
const content = waterConservationTaskBookV3;

function context(actorId: string, source: "UI" | "AGENT" = "UI"): CommandContext {
  return { actorId, source, traceId: randomUUID(), clock: () => now };
}

/** A section of the discipline's own standard, not the shared curriculum plan. */
function sectionFor(disciplineCode: "physics" | "math" | "english") {
  const label = { physics: "物理", math: "数学", english: "英语" }[disciplineCode];
  const found = searchOfficialKnowledge({
    query: "课程目标 核心素养",
    schoolStage: "MIDDLE",
    disciplineCodes: [disciplineCode],
    limit: 8,
  }).results.find((item) => item.sourceTitle.includes(label));
  if (!found) throw new Error(`No ${label} section in the corpus`);
  return found;
}

async function fixture() {
  const school = await db!.school.create({ data: { name: "依据测试学校", code: generateSchoolCode(), teacherInviteCodeHash: "a".repeat(64) } });
  const teacher = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "依据教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const other = await db!.appUser.create({ data: { authSubject: randomUUID(), role: "TEACHER", displayName: "其他教师", schoolId: school.id, staffNo: `T-${randomUUID().slice(0, 8).toUpperCase()}` } });
  const classroom = await db!.classroom.create({ data: { name: "依据班级", schoolId: school.id, managerId: teacher.id } });
  const draft = await saveActivityDraft(db!, context(teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content, idempotencyKey: randomUUID() });
  return { teacher, other, classroom, draft };
}

suite("N4a source evidence", () => {
  afterAll(async () => db?.$disconnect());

  it("keeps an approved Agent proposal's references with its first revision, once", async () => {
    const f = await fixture();
    const physics = sectionFor("physics");
    const math = sectionFor("math");
    const run = await startActivityAssistantRun(db!, context(f.teacher.id), { model: "fake" });
    const input = {
      draftId: null,
      expectedVersion: null,
      desiredStatus: "READY_FOR_PREVIEW" as const,
      content,
      agentRunId: run.id,
      sourceReferences: [
        { sourceId: physics.sourceId, sectionId: physics.sectionId, rationale: "支撑观察与机理解释" },
        { sourceId: math.sourceId, sectionId: math.sectionId, rationale: "支撑数据分析" },
      ],
      idempotencyKey: randomUUID(),
    };
    const saved = await saveActivityDraft(db!, context(f.teacher.id, "AGENT"), input);
    expect(await saveActivityDraft(db!, context(f.teacher.id, "AGENT"), input)).toEqual(saved);

    const rows = await db!.activityDraftSourceReference.findMany({ where: { draftId: saved.draftId }, orderBy: { rationale: "asc" } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ origin: "AGENT_PROPOSAL", agentRunId: run.id, revisionId: saved.revisionId, adoptedById: f.teacher.id });
      expect(row.citationLabel).toMatch(/^《/);
    }
    const view = await getActivitySourceReferences(db!, context(f.teacher.id), saved.draftId);
    expect(view?.references.map((reference) => [reference.origin, reference.corpusStatus, reference.adoptedAtVersion])).toEqual([
      ["AGENT_PROPOSAL", "MATCH", 1],
      ["AGENT_PROPOSAL", "MATCH", 1],
    ]);
    expect(await getActivitySourceReferences(db!, context(f.other.id), saved.draftId)).toBeNull();
  });

  it("refuses references from UI saves or unknown sections without writing a draft", async () => {
    const f = await fixture();
    const physics = sectionFor("physics");
    const before = await db!.activityDraft.count({ where: { ownerId: f.teacher.id } });
    await expect(
      saveActivityDraft(db!, context(f.teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content, sourceReferences: [{ sourceId: physics.sourceId, sectionId: physics.sectionId, rationale: "手工表单不能带依据" }], idempotencyKey: randomUUID() }),
    ).rejects.toEqual(new SaveActivityDraftError("INVALID_SOURCE_REFERENCES"));
    const run = await startActivityAssistantRun(db!, context(f.teacher.id), { model: "fake" });
    await expect(
      saveActivityDraft(db!, context(f.teacher.id, "AGENT"), { draftId: null, expectedVersion: null, desiredStatus: "EDITING", content, agentRunId: run.id, sourceReferences: [{ sourceId: physics.sourceId, sectionId: "forged-section-000", rationale: "伪造章节" }], idempotencyKey: randomUUID() }),
    ).rejects.toEqual(new SaveActivityDraftError("INVALID_SOURCE_REFERENCES"));
    expect(await db!.activityDraft.count({ where: { ownerId: f.teacher.id } })).toBe(before);
  });

  it("adopts, rejects duplicates and inapplicable sections, withdraws and re-adopts", async () => {
    const f = await fixture();
    const physics = sectionFor("physics");
    const input = { draftId: f.draft.draftId, sourceId: physics.sourceId, sectionId: physics.sectionId, rationale: "说明观察任务的课标要求", idempotencyKey: randomUUID() };
    const adopted = await adoptActivitySource(db!, context(f.teacher.id), input);
    expect(adopted.revisionVersion).toBe(1);
    expect(await adoptActivitySource(db!, context(f.teacher.id), input)).toEqual(adopted);
    await expect(adoptActivitySource(db!, context(f.teacher.id), { ...input, rationale: "换理由", idempotencyKey: input.idempotencyKey })).rejects.toEqual(new ActivitySourceReferenceError("IDEMPOTENCY_MISMATCH"));
    await expect(adoptActivitySource(db!, context(f.teacher.id), { ...input, idempotencyKey: randomUUID() })).rejects.toEqual(new ActivitySourceReferenceError("ALREADY_ADOPTED"));

    const english = sectionFor("english");
    await expect(adoptActivitySource(db!, context(f.teacher.id), { ...input, sourceId: english.sourceId, sectionId: english.sectionId, idempotencyKey: randomUUID() })).rejects.toEqual(new ActivitySourceReferenceError("SOURCE_NOT_APPLICABLE"));
    await expect(adoptActivitySource(db!, context(f.other.id), { ...input, idempotencyKey: randomUUID() })).rejects.toEqual(new ActivitySourceReferenceError("NOT_FOUND"));

    // The draft moves on; the reference stays bound to version 1.
    await saveActivityDraft(db!, context(f.teacher.id), { draftId: f.draft.draftId, expectedVersion: 1, desiredStatus: "EDITING", content: { ...content, summary: "改过" }, idempotencyKey: randomUUID() });
    await expect(withdrawActivitySource(db!, context(f.other.id), { referenceId: adopted.referenceId })).rejects.toEqual(new ActivitySourceReferenceError("NOT_FOUND"));
    await withdrawActivitySource(db!, context(f.teacher.id), { referenceId: adopted.referenceId });
    await withdrawActivitySource(db!, context(f.teacher.id), { referenceId: adopted.referenceId });
    const again = await adoptActivitySource(db!, context(f.teacher.id), { ...input, idempotencyKey: randomUUID() });
    expect(again.revisionVersion).toBe(2);

    const view = await getActivitySourceReferences(db!, context(f.teacher.id), f.draft.draftId);
    expect(view?.currentVersion).toBe(2);
    expect(view?.references.map((reference) => [reference.origin, reference.adoptedAtVersion, reference.withdrawnAt !== null])).toEqual([
      ["TEACHER_SELECTION", 1, true],
      ["TEACHER_SELECTION", 2, false],
    ]);
  });

  it("freezes evidence once published and guards history in the database", async () => {
    const f = await fixture();
    const physics = sectionFor("physics");
    const ready = await saveActivityDraft(db!, context(f.teacher.id), { draftId: null, expectedVersion: null, desiredStatus: "READY_FOR_PREVIEW", content, idempotencyKey: randomUUID() });
    const adopted = await adoptActivitySource(db!, context(f.teacher.id), { draftId: ready.draftId, sourceId: physics.sourceId, sectionId: physics.sectionId, rationale: "发布前采纳", idempotencyKey: randomUUID() });
    await createPublishedActivity(db!, { teacherId: f.teacher.id, classroomId: f.classroom.id, publishedAt: now, draft: ready });
    await expect(withdrawActivitySource(db!, context(f.teacher.id), { referenceId: adopted.referenceId })).rejects.toEqual(new ActivitySourceReferenceError("DRAFT_SEALED"));

    await expect(db!.activityDraftSourceReference.update({ where: { id: adopted.referenceId }, data: { rationale: "改写历史" } })).rejects.toThrow();
    await expect(db!.activityDraftSourceReference.delete({ where: { id: adopted.referenceId } })).rejects.toThrow();

    const g = await fixture();
    const revision = await db!.activityDraftRevision.findFirstOrThrow({ where: { draftId: g.draft.draftId } });
    const row = { draftId: g.draft.draftId, revisionId: revision.id, sourceId: physics.sourceId, sectionId: physics.sectionId, sourceHash: "a".repeat(64), contentHash: "b".repeat(64), citationLabel: "《伪造》", rationale: "直接写库" };
    // Adopted by someone other than the owner.
    await expect(db!.activityDraftSourceReference.create({ data: { ...row, origin: "TEACHER_SELECTION", adoptedById: g.other.id } })).rejects.toThrow();
    // Claims an Agent proposal on a MANUAL revision.
    const run = await startActivityAssistantRun(db!, context(g.teacher.id), { model: "fake" });
    await expect(db!.activityDraftSourceReference.create({ data: { ...row, origin: "AGENT_PROPOSAL", agentRunId: run.id, adoptedById: g.teacher.id } })).rejects.toThrow();

    // A stored hash that no longer matches the corpus is reported, not hidden.
    await db!.activityDraftSourceReference.create({ data: { ...row, origin: "TEACHER_SELECTION", adoptedById: g.teacher.id } });
    const view = await getActivitySourceReferences(db!, context(g.teacher.id), g.draft.draftId);
    expect(view?.references[0]?.corpusStatus).toBe("CHANGED");
    const ref = await db!.activityDraftSourceReference.findFirstOrThrow({ where: { draftId: g.draft.draftId } });
    await expect(db!.activityDraftSourceWithdrawal.create({ data: { referenceId: ref.id, withdrawnById: g.other.id } })).rejects.toThrow();
  });
});
