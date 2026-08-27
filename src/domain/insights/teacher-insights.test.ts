import { describe, expect, it } from "vitest";
import { waterConservationTaskBook } from "../../fixtures/water-conservation";
import type {
  InsightsOutcome,
  InsightsReleaseInput,
  InsightsSubmissionInput,
} from "./teacher-insights";
import {
  aggregateFeedbackImprovement,
  aggregateRubricCard,
  aggregateStageCard,
  buildTeacherInsightsView,
  currentAudienceProgress,
} from "./teacher-insights";

const releaseId = "11111111-1111-4111-8111-111111111111";
const otherReleaseId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const studentA = "44444444-4444-4444-8444-444444444444";
const studentB = "55555555-5555-4555-8555-555555555555";
const studentC = "66666666-6666-4666-8666-666666666666";

function level(
  index: number,
  name: string,
  value: InsightsOutcome["status"] extends never ? never : "excellent" | "good" | "pass" | "improve" | "insufficient",
): InsightsOutcome {
  if (value === "insufficient") {
    return {
      dimensionIndex: index,
      dimensionName: name,
      status: "INSUFFICIENT_EVIDENCE",
    };
  }
  return {
    dimensionIndex: index,
    dimensionName: name,
    status: "LEVEL",
    level: value,
  };
}

function covering(
  values: Array<"excellent" | "good" | "pass" | "improve" | "insufficient">,
): InsightsOutcome[] {
  return waterConservationTaskBook.rubricDimensions.map((dimension, index) =>
    level(index + 1, dimension.name, values[index] ?? "pass"),
  );
}

function submission(
  overrides: Partial<InsightsSubmissionInput> & Pick<InsightsSubmissionInput, "id">,
): InsightsSubmissionInput {
  return {
    phaseIndex: 0,
    latestRevisionNumber: 0,
    studentId: studentA,
    groupId: null,
    revisions: [],
    ...overrides,
  };
}

function release(
  overrides: Partial<InsightsReleaseInput> = {},
): InsightsReleaseInput {
  return {
    id: releaseId,
    title: "校园节水行动",
    classroomName: "七年一班",
    executionVersion: 1,
    submissionMode: "phased",
    phases: waterConservationTaskBook.phases.map((phase) => ({
      name: phase.name,
    })),
    rubricDimensions: waterConservationTaskBook.rubricDimensions.map(
      (dimension) => ({ name: dimension.name }),
    ),
    groups: [],
    currentMemberIds: [studentA, studentB, studentC],
    submissions: [],
    ...overrides,
  };
}

describe("currentAudienceProgress", () => {
  it("matches teacher/student current-phase: first incomplete phase, REVISE ignored", () => {
    expect(
      currentAudienceProgress({
        executionVersion: 1,
        submissionMode: "phased",
        phaseCount: 3,
        submissions: [
          { phaseIndex: 1, latestRevisionNumber: 1 },
          { phaseIndex: 2, latestRevisionNumber: 0 },
        ],
      }),
    ).toEqual({
      started: true,
      complete: false,
      currentPhaseIndex: 2,
      completedPhaseCount: 1,
    });
    expect(
      currentAudienceProgress({
        executionVersion: 0,
        submissionMode: "once",
        phaseCount: 0,
        submissions: [{ phaseIndex: 0, latestRevisionNumber: 1 }],
      }).complete,
    ).toBe(true);
  });
});

describe("aggregateRubricCard", () => {
  it("returns an empty-input card without NaN or invented dimensions", () => {
    expect(aggregateRubricCard(release()).status).toBe("no_evaluations");
    expect(aggregateRubricCard(release()).sampleCount).toBe(0);
    expect(
      aggregateRubricCard(release({ rubricDimensions: null })).status,
    ).toBe("no_rubric");
  });

  it("aggregates the current evaluated revision and marks the weakest dimension", () => {
    const card = aggregateRubricCard(
      release({
        submissions: [
          submission({
            id: "s1",
            latestRevisionNumber: 2,
            revisions: [
              {
                revisionNumber: 1,
                nextStep: "REVISE",
                outcomes: covering(["improve", "improve", "improve", "improve"]),
              },
              {
                revisionNumber: 2,
                nextStep: null,
                outcomes: covering(["good", "improve", "pass", "insufficient"]),
              },
            ],
          }),
          submission({
            id: "s2",
            studentId: studentB,
            latestRevisionNumber: 1,
            revisions: [
              {
                revisionNumber: 1,
                nextStep: null,
                outcomes: covering(["excellent", "improve", "good", "pass"]),
              },
            ],
          }),
        ],
      }),
    );

    expect(card.status).toBe("ready");
    expect(card.sampleCount).toBe(2);
    expect(card.dimensions.map((dimension) => dimension.dimensionName)).toEqual(
      waterConservationTaskBook.rubricDimensions.map((dimension) => dimension.name),
    );
    expect(card.dimensions[1]).toMatchObject({
      dimensionName: "证据质量",
      improve: 2,
      weak: true,
    });
    expect(card.dimensions.filter((dimension) => dimension.weak)).toHaveLength(1);
  });

  it("does not mix rubric dimensions across releases", () => {
    const water = aggregateRubricCard(
      release({
        submissions: [
          submission({
            id: "s1",
            latestRevisionNumber: 1,
            revisions: [
              {
                revisionNumber: 1,
                nextStep: null,
                outcomes: covering(["improve", "good", "good", "good"]),
              },
            ],
          }),
        ],
      }),
    );
    const other = aggregateRubricCard(
      release({
        id: otherReleaseId,
        title: "校园调查",
        rubricDimensions: [
          { name: "问题意识" },
          { name: "合作" },
          { name: "表达" },
          { name: "反思" },
        ],
        submissions: [
          submission({
            id: "s2",
            latestRevisionNumber: 1,
            revisions: [
              {
                revisionNumber: 1,
                nextStep: null,
                outcomes: [
                  level(1, "问题意识", "good"),
                  level(2, "合作", "improve"),
                  level(3, "表达", "pass"),
                  level(4, "反思", "excellent"),
                ],
              },
            ],
          }),
        ],
      }),
    );
    const view = buildTeacherInsightsView(
      [
        release({
          submissions: [
            submission({
              id: "s1",
              latestRevisionNumber: 1,
              revisions: [
                {
                  revisionNumber: 1,
                  nextStep: null,
                  outcomes: covering(["improve", "good", "good", "good"]),
                },
              ],
            }),
          ],
        }),
        release({
          id: otherReleaseId,
          title: "校园调查",
          rubricDimensions: [
            { name: "问题意识" },
            { name: "合作" },
            { name: "表达" },
            { name: "反思" },
          ],
          submissions: [
            submission({
              id: "s2",
              latestRevisionNumber: 1,
              revisions: [
                {
                  revisionNumber: 1,
                  nextStep: null,
                  outcomes: [
                    level(1, "问题意识", "good"),
                    level(2, "合作", "improve"),
                    level(3, "表达", "pass"),
                    level(4, "反思", "excellent"),
                  ],
                },
              ],
            }),
          ],
        }),
      ],
      null,
    );

    expect(water.dimensions.map((dimension) => dimension.dimensionName)).toEqual(
      ["问题意识", "证据质量", "跨学科连接", "方案表达"],
    );
    expect(other.dimensions.map((dimension) => dimension.dimensionName)).toEqual(
      ["问题意识", "合作", "表达", "反思"],
    );
    expect(view.rubric).toHaveLength(2);
    expect(view.rubric[0]?.dimensions.some((dimension) => dimension.dimensionName === "合作")).toBe(false);
    expect(view.rubric[1]?.dimensions.some((dimension) => dimension.dimensionName === "证据质量")).toBe(false);
  });
});

describe("aggregateStageCard", () => {
  it("counts a group as one audience and ungrouped students individually", () => {
    const card = aggregateStageCard(
      release({
        groups: [{ id: groupId, memberIds: [studentA, studentB] }],
        submissions: [
          submission({
            id: "g1",
            phaseIndex: 1,
            latestRevisionNumber: 1,
            studentId: null,
            groupId,
            revisions: [
              { revisionNumber: 1, nextStep: "REVISE", outcomes: null },
            ],
          }),
        ],
      }),
    );

    expect(card.audienceCount).toBe(2);
    expect(card.buckets).toEqual([
      { key: "not_started", label: "尚未开始", count: 1 },
      { key: "phase:1", label: "观察与问题界定", count: 0 },
      { key: "phase:2", label: "调查与分析", count: 1 },
      { key: "phase:3", label: "建议与公开表达", count: 0 },
      { key: "complete", label: "全部完成", count: 0 },
    ]);
  });
});

describe("aggregateFeedbackImprovement", () => {
  it("treats REVISE without a later revision as not resubmitted", () => {
    expect(
      aggregateFeedbackImprovement([
        release({
          submissions: [
            submission({
              id: "s1",
              latestRevisionNumber: 1,
              revisions: [
                { revisionNumber: 1, nextStep: "REVISE", outcomes: covering(["pass", "pass", "pass", "pass"]) },
              ],
            }),
          ],
        }),
      ]),
    ).toEqual({
      reviseCount: 1,
      resubmittedCount: 0,
      evaluationPairs: 0,
      rose: 0,
      unchanged: 0,
      fell: 0,
    });
  });

  it("counts resubmission and level movement when both revisions are evaluated", () => {
    expect(
      aggregateFeedbackImprovement([
        release({
          submissions: [
            submission({
              id: "s1",
              latestRevisionNumber: 2,
              revisions: [
                {
                  revisionNumber: 1,
                  nextStep: "REVISE",
                  outcomes: covering(["improve", "pass", "good", "insufficient"]),
                },
                {
                  revisionNumber: 2,
                  nextStep: "CONTINUE",
                  outcomes: covering(["pass", "pass", "pass", "improve"]),
                },
              ],
            }),
          ],
        }),
      ]),
    ).toEqual({
      reviseCount: 1,
      resubmittedCount: 1,
      evaluationPairs: 1,
      rose: 2,
      unchanged: 1,
      fell: 1,
    });
  });
});

describe("buildTeacherInsightsView", () => {
  it("filters by release without dropping the option list", () => {
    const view = buildTeacherInsightsView(
      [release(), release({ id: otherReleaseId, title: "另一项" })],
      otherReleaseId,
    );
    expect(view.releaseOptions).toHaveLength(2);
    expect(view.rubric).toHaveLength(1);
    expect(view.stages[0]?.releaseId).toBe(otherReleaseId);
  });
});
