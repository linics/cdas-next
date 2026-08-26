import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import {
  createTeacherEvaluationPayload,
  hashTeacherEvaluationPayload,
  hashTeacherEvaluationSummary,
  teacherEvaluationPayloadSchema,
  type TeacherEvaluationOutcome,
} from "./teacher-evaluation-intent";
import { TEACHER_EVALUATION_SUMMARY_MAX_LENGTH } from "./teacher-evaluation-policy";

const attachmentId = "11111111-1111-4111-8111-111111111111";

function evidence(overrides?: {
  textEvidence?: string;
  attachmentIds?: string[];
  completedEvidenceIndexes?: number[];
}) {
  return {
    content: waterConservationTaskBook,
    textEvidence: overrides?.textEvidence ?? "观察记录：午间饮水区持续流水。",
    attachmentIds: overrides?.attachmentIds ?? [attachmentId],
    completedEvidenceIndexes: overrides?.completedEvidenceIndexes ?? [1],
  };
}

function coveringOutcomes(): TeacherEvaluationOutcome[] {
  return waterConservationTaskBook.rubricDimensions.map((dimension, index) => ({
    dimensionIndex: index + 1,
    dimensionName: dimension.name,
    status: "LEVEL" as const,
    level: "good" as const,
    citations: [{ kind: "text" as const }],
  }));
}

function payloadInput() {
  return {
    submissionId: randomUUID(),
    submissionRevisionId: randomUUID(),
    expectedSubmissionRevisionNumber: 1,
    expectedEvaluationVersion: 0,
    summary: "证据能支持四个维度的判断。",
    outcomes: coveringOutcomes(),
    suggestionAgentRunId: null,
  };
}

describe("teacher evaluation intent payload", () => {
  it("covers every frozen rubric dimension in snapshot order", () => {
    const payload = createTeacherEvaluationPayload(payloadInput(), evidence());
    expect(payload.schemaVersion).toBe(1);
    expect(payload.outcomes).toHaveLength(4);
    expect(payload.outcomes.map((outcome) => outcome.dimensionName)).toEqual(
      waterConservationTaskBook.rubricDimensions.map((dimension) => dimension.name),
    );
    expect(hashTeacherEvaluationSummary(payload.summary)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("allows insufficient evidence without citations or a level", () => {
    const input = payloadInput();
    input.outcomes = coveringOutcomes();
    input.outcomes[1] = {
      dimensionIndex: 2,
      dimensionName: waterConservationTaskBook.rubricDimensions[1]!.name,
      status: "INSUFFICIENT_EVIDENCE",
      citations: [],
    };
    const payload = createTeacherEvaluationPayload(input, evidence());
    expect(payload.outcomes[1]).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      citations: [],
    });
    expect("level" in payload.outcomes[1]!).toBe(false);
  });

  it("rejects missing dimensions, name drift, unauthorized citations, and duplicates", () => {
    const incomplete = payloadInput();
    incomplete.outcomes = coveringOutcomes().slice(0, 3);
    expect(() => createTeacherEvaluationPayload(incomplete, evidence())).toThrow();

    const renamed = payloadInput();
    renamed.outcomes = coveringOutcomes();
    renamed.outcomes[0] = {
      ...renamed.outcomes[0]!,
      dimensionName: "不是快照里的维度",
    };
    expect(() => createTeacherEvaluationPayload(renamed, evidence())).toThrow();

    const unauthorized = payloadInput();
    unauthorized.outcomes = coveringOutcomes();
    unauthorized.outcomes[0] = {
      ...unauthorized.outcomes[0]!,
      citations: [{ kind: "attachment" as const, attachmentId: randomUUID() }],
    };
    expect(() =>
      createTeacherEvaluationPayload(unauthorized, evidence()),
    ).toThrow();

    const duplicate = payloadInput();
    duplicate.outcomes = coveringOutcomes();
    duplicate.outcomes[0] = {
      ...duplicate.outcomes[0]!,
      citations: [{ kind: "text" }, { kind: "text" }],
    };
    expect(() => createTeacherEvaluationPayload(duplicate, evidence())).toThrow();
  });

  it("rejects schema v1 snapshots and empty summaries", () => {
    expect(() =>
      createTeacherEvaluationPayload(payloadInput(), {
        ...evidence(),
        content: {
          schemaVersion: 1,
          title: "旧活动",
          summary: "没有四档量规",
          learningObjectives: ["目标"],
          taskInstructions: "提交文字",
          evidenceRequirements: ["文字"],
          feedbackCriteria: ["清楚"],
        },
      }),
    ).toThrow();
    expect(() =>
      createTeacherEvaluationPayload({ ...payloadInput(), summary: " \n " }, evidence()),
    ).toThrow();
  });

  it("keeps mixed citation hashes after JSON persistence", () => {
    const input = payloadInput();
    input.outcomes = coveringOutcomes();
    input.outcomes[1] = {
      dimensionIndex: 2,
      dimensionName: waterConservationTaskBook.rubricDimensions[1]!.name,
      status: "INSUFFICIENT_EVIDENCE",
      citations: [],
    };
    input.outcomes[2] = {
      ...input.outcomes[2]!,
      citations: [{ kind: "attachment", attachmentId }],
    };
    input.outcomes[3] = {
      ...input.outcomes[3]!,
      citations: [{ kind: "checkpoint", evidenceIndex: 1 }],
    };
    const payload = createTeacherEvaluationPayload(input, evidence());
    const persisted = JSON.parse(JSON.stringify(payload));
    expect(hashTeacherEvaluationPayload(persisted)).toBe(
      hashTeacherEvaluationPayload(payload),
    );
  });

  it("hashes the complete payload and rejects extra fields or oversized summaries", () => {
    const payload = createTeacherEvaluationPayload(payloadInput(), evidence());
    expect(hashTeacherEvaluationPayload({ ...payload, outcomes: [...payload.outcomes] })).toBe(
      hashTeacherEvaluationPayload(payload),
    );
    expect(
      hashTeacherEvaluationPayload({ ...payload, summary: "另一份综评" }),
    ).not.toBe(hashTeacherEvaluationPayload(payload));
    expect(() =>
      teacherEvaluationPayloadSchema.parse({ ...payload, schemaVersion: 2 }),
    ).toThrow();
    expect(() =>
      createTeacherEvaluationPayload(
        { ...payloadInput(), actorId: randomUUID() },
        evidence(),
      ),
    ).toThrow();
    expect(() =>
      createTeacherEvaluationPayload(
        {
          ...payloadInput(),
          summary: "👍".repeat(TEACHER_EVALUATION_SUMMARY_MAX_LENGTH + 1),
        },
        evidence(),
      ),
    ).toThrow();
  });
});
