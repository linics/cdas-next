import { describe, expect, it } from "vitest";
import {
  buildReleaseDiagnosis,
  STALL_DAYS,
  type DiagnosisReleaseInput,
  type DiagnosisSubmissionInput,
} from "./release-diagnosis";
import type { InsightsOutcome } from "./teacher-insights";

const NOW = new Date("2026-10-02T04:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function outcomes(
  ...levels: ("excellent" | "good" | "pass" | "improve" | "insufficient")[]
): InsightsOutcome[] {
  const names = ["问题与机理", "数据与证据", "跨学科连接"];
  return levels.map((level, index) =>
    level === "insufficient"
      ? {
          dimensionIndex: index + 1,
          dimensionName: names[index]!,
          status: "INSUFFICIENT_EVIDENCE",
        }
      : {
          dimensionIndex: index + 1,
          dimensionName: names[index]!,
          status: "LEVEL",
          level,
        },
  );
}

function revision(
  overrides: Partial<NonNullable<DiagnosisSubmissionInput["currentRevision"]>> = {},
): NonNullable<DiagnosisSubmissionInput["currentRevision"]> {
  return {
    submittedAt: daysAgo(1),
    isLate: false,
    hasFeedback: true,
    completedEvidenceIndexes: [],
    supportLevel: null,
    feedbackConfirmedAt: null,
    ...overrides,
  };
}

function submission(
  overrides: Partial<DiagnosisSubmissionInput> & { id: string },
): DiagnosisSubmissionInput {
  return {
    phaseIndex: 1,
    latestRevisionNumber: 1,
    studentId: null,
    groupId: null,
    final: false,
    workingCopyUpdatedAt: null,
    currentRevision: revision(),
    revisions: [{ revisionNumber: 1, nextStep: "CONTINUE", outcomes: null }],
    ...overrides,
  };
}

function release(
  overrides: Partial<DiagnosisReleaseInput> = {},
): DiagnosisReleaseInput {
  return {
    id: "release-1",
    title: "校园节水行动",
    classroomName: "七年一班",
    status: "ACTIVE",
    dueAt: null,
    executionVersion: 1,
    submissionMode: "phased",
    phases: [
      {
        name: "现场认定",
        learningGoalIds: ["g1"],
        evidence: [
          { description: "漏水点的位置与照片", typeLabel: "图片" },
          { description: "和同伴核对过位置", typeLabel: "现场确认" },
        ],
      },
      { name: "读数与估算", learningGoalIds: ["g2"], evidence: [] },
    ],
    rubricDimensions: [
      { name: "问题与机理", learningGoalIds: ["g1"] },
      { name: "数据与证据", learningGoalIds: ["g2"] },
      { name: "跨学科连接", learningGoalIds: ["g1", "g2"] },
    ],
    members: [
      { id: "s-chen", name: "陈同学" },
      { id: "s-li", name: "李明" },
      { id: "s-wang", name: "王芳" },
      { id: "s-zhao", name: "赵强" },
    ],
    groups: [],
    submissions: [],
    ...overrides,
  };
}

describe("release diagnosis", () => {
  it("places every audience in one lane and names who has not started", () => {
    const diagnosis = buildReleaseDiagnosis(
      release({
        submissions: [
          submission({ id: "a1", studentId: "s-chen", phaseIndex: 1 }),
          submission({ id: "a2", studentId: "s-chen", phaseIndex: 2, final: true }),
          submission({ id: "b1", studentId: "s-li", phaseIndex: 1 }),
        ],
      }),
      NOW,
    );

    expect(diagnosis.unit).toBe("人");
    expect(diagnosis.audienceCount).toBe(4);
    expect(diagnosis.completeCount).toBe(1);
    expect(
      diagnosis.lanes.map((lane) => [lane.label, lane.audiences.map((a) => a.name)]),
    ).toEqual([
      ["尚未开始", ["王芳", "赵强"]],
      ["现场认定", []],
      ["读数与估算", ["李明"]],
      ["全部完成", ["陈同学"]],
    ]);
    const notStarted = diagnosis.alerts.find((alert) => alert.kind === "not_started");
    expect(notStarted).toMatchObject({
      text: "2 人还没开始",
      basis: "王芳、赵强",
      action: { query: "?stage=not_started#progress" },
    });
  });

  it("flags an unfinished audience as stalled only after the idle threshold", () => {
    const build = (idle: number) =>
      buildReleaseDiagnosis(
        release({
          submissions: [
            submission({
              id: "a1",
              studentId: "s-chen",
              currentRevision: revision({ submittedAt: daysAgo(idle + 3), hasFeedback: true }),
              workingCopyUpdatedAt: daysAgo(idle),
            }),
          ],
        }),
        NOW,
      );

    const fresh = build(STALL_DAYS - 1);
    expect(fresh.alerts.some((alert) => alert.kind === "stalled")).toBe(false);

    const stalled = build(STALL_DAYS);
    const chen = stalled.lanes
      .flatMap((lane) => lane.audiences)
      .find((audience) => audience.name === "陈同学");
    expect(chen).toMatchObject({ stalled: true, idleDays: STALL_DAYS, latestSubmissionId: "a1" });
    expect(stalled.alerts.find((alert) => alert.kind === "stalled")).toMatchObject({
      text: `「读数与估算」有 1 人超过 ${STALL_DAYS} 天没有改动`,
      action: { query: "?stage=phase%3A2#progress" },
    });
  });

  it("never calls a finished audience or a closed release stalled", () => {
    const quiet = submission({
      id: "a1",
      studentId: "s-chen",
      currentRevision: revision({ submittedAt: daysAgo(30), hasFeedback: true }),
    });
    const closed = buildReleaseDiagnosis(
      release({ status: "CLOSED", submissions: [quiet] }),
      NOW,
    );
    expect(closed.alerts.map((alert) => alert.kind)).toEqual([]);

    const finished = buildReleaseDiagnosis(
      release({
        submissions: [
          quiet,
          submission({
            id: "a2",
            studentId: "s-chen",
            phaseIndex: 2,
            final: true,
            currentRevision: revision({ submittedAt: daysAgo(30), hasFeedback: true }),
          }),
        ],
        members: [{ id: "s-chen", name: "陈同学" }],
      }),
      NOW,
    );
    expect(finished.alerts).toEqual([]);
  });

  it("raises urgency when the deadline is close", () => {
    const diagnosis = buildReleaseDiagnosis(
      release({ dueAt: new Date(NOW.getTime() + 36 * 60 * 60 * 1000).toISOString() }),
      NOW,
    );
    expect(diagnosis.alerts[0]).toMatchObject({
      kind: "not_started",
      tone: "urgent",
      text: "4 人还没开始",
      basis: "陈同学、李明、王芳、赵强 · 距截止还有 1 天",
    });
  });

  it("counts groups as one audience and says so", () => {
    const diagnosis = buildReleaseDiagnosis(
      release({
        groups: [
          { id: "g-a", name: "第一组", memberIds: ["s-chen", "s-li"] },
          { id: "g-b", name: "第二组", memberIds: ["s-wang", "s-zhao"] },
        ],
        submissions: [submission({ id: "g1", groupId: "g-a" })],
      }),
      NOW,
    );
    expect(diagnosis.unit).toBe("组");
    expect(diagnosis.audienceCount).toBe(2);
    expect(diagnosis.alerts.find((alert) => alert.kind === "not_started")?.text).toBe(
      "1 组还没开始",
    );
  });

  it("builds matrix rows per submission in roster order and masks irrelevant dimensions", () => {
    const diagnosis = buildReleaseDiagnosis(
      release({
        submissions: [
          // A legacy phase-1 evaluation: 数据与证据 only serves goal 2.
          submission({
            id: "w1",
            studentId: "s-wang",
            phaseIndex: 1,
            revisions: [
              {
                revisionNumber: 1,
                nextStep: "CONTINUE",
                outcomes: outcomes("pass", "insufficient", "improve"),
              },
            ],
          }),
          submission({
            id: "c2",
            studentId: "s-chen",
            phaseIndex: 2,
            final: true,
            revisions: [
              {
                revisionNumber: 1,
                nextStep: "CONTINUE",
                outcomes: outcomes("insufficient", "excellent", "good"),
              },
            ],
          }),
          // A final submission still waiting for its evaluation.
          submission({ id: "l2", studentId: "s-li", phaseIndex: 2, final: true }),
          // An unevaluated phase submission never takes a rubric: not a row.
          submission({ id: "l1", studentId: "s-li", phaseIndex: 1 }),
        ],
      }),
      NOW,
    );

    expect(
      diagnosis.matrix.rows.map((row) => [
        row.audienceName,
        row.phaseLabel,
        row.evaluated,
        row.cells,
      ]),
    ).toEqual([
      ["陈同学", null, true, ["irrelevant", "excellent", "good"]],
      ["李明", null, false, ["none", "none", "none"]],
      ["王芳", "现场认定", true, ["pass", "irrelevant", "improve"]],
    ]);
    expect(
      diagnosis.matrix.dimensions.map((dimension) => [
        dimension.dimensionName,
        dimension.sampleCount,
        dimension.lowCount,
      ]),
    ).toEqual([
      ["问题与机理", 1, 0],
      ["数据与证据", 1, 0],
      ["跨学科连接", 2, 1],
    ]);
  });

  it("only calls a dimension weak when most of at least three evaluations are low", () => {
    const evaluated = (id: string, studentId: string, third: "improve" | "good") =>
      submission({
        id,
        studentId,
        phaseIndex: 2,
        final: true,
        revisions: [
          {
            revisionNumber: 1,
            nextStep: "CONTINUE",
            outcomes: outcomes("good", "good", third),
          },
        ],
      });

    const two = buildReleaseDiagnosis(
      release({
        submissions: [
          evaluated("a", "s-chen", "improve"),
          evaluated("b", "s-li", "improve"),
        ],
      }),
      NOW,
    );
    expect(two.matrix.dimensions.some((dimension) => dimension.weak)).toBe(false);
    expect(two.alerts.some((alert) => alert.kind === "weak_dimension")).toBe(false);

    const four = buildReleaseDiagnosis(
      release({
        submissions: [
          evaluated("a", "s-chen", "improve"),
          evaluated("b", "s-li", "improve"),
          evaluated("c", "s-wang", "good"),
          evaluated("d", "s-zhao", "good"),
        ],
      }),
      NOW,
    );
    expect(
      four.matrix.dimensions.filter((dimension) => dimension.weak).map((d) => d.dimensionName),
    ).toEqual(["跨学科连接"]);
    expect(four.alerts.find((alert) => alert.kind === "weak_dimension")).toMatchObject({
      text: "「跨学科连接」4 份相关评价中 2 份需改进或证据不足",
      action: { label: "看这 2 份", query: "?dim=3" },
    });
  });

  it("puts waiting feedback first among same-tone alerts and reports the wait", () => {
    const diagnosis = buildReleaseDiagnosis(
      release({
        members: [{ id: "s-chen", name: "陈同学" }],
        submissions: [
          submission({
            id: "a1",
            studentId: "s-chen",
            phaseIndex: 1,
            currentRevision: revision({ submittedAt: daysAgo(STALL_DAYS + 1), hasFeedback: false }),
            revisions: [{ revisionNumber: 1, nextStep: null, outcomes: null }],
          }),
          submission({
            id: "a2",
            studentId: "s-chen",
            phaseIndex: 2,
            final: true,
            latestRevisionNumber: 1,
            currentRevision: revision({ submittedAt: daysAgo(0), hasFeedback: true }),
            revisions: [{ revisionNumber: 1, nextStep: "REVISE", outcomes: null }],
          }),
        ],
      }),
      NOW,
    );
    expect(diagnosis.alerts.map((alert) => [alert.kind, alert.tone])).toEqual([
      ["awaiting_feedback", "urgent"],
      ["awaiting_resubmission", "note"],
    ]);
    expect(diagnosis.alerts[0]).toMatchObject({
      text: "1 份提交在等你的反馈",
      basis: `最早的一份已经等了 ${STALL_DAYS + 1} 天`,
      action: { label: "开始评阅", query: "?queue=feedback", primary: true },
    });
    expect(diagnosis.alerts[1]?.text).toBe("要求重交的 1 份里 1 份还没重交");
  });

  it("counts ticked evidence per phase and raises an alert when most skip an item", () => {
    const phaseOne = (id: string, studentId: string, ticked: number[]) =>
      submission({
        id,
        studentId,
        phaseIndex: 1,
        currentRevision: revision({ completedEvidenceIndexes: ticked }),
      });
    const diagnosis = buildReleaseDiagnosis(
      release({
        submissions: [
          phaseOne("c1", "s-chen", [1, 2]),
          phaseOne("l1", "s-li", [2]),
          phaseOne("w1", "s-wang", [2]),
          // A started-but-unsubmitted phase is not part of the count.
          submission({
            id: "z1",
            studentId: "s-zhao",
            phaseIndex: 1,
            latestRevisionNumber: 0,
            currentRevision: null,
            revisions: [],
          }),
        ],
      }),
      NOW,
    );

    expect(diagnosis.evidence).toHaveLength(1);
    expect(diagnosis.evidence[0]).toMatchObject({
      phaseName: "现场认定",
      submittedCount: 3,
    });
    expect(
      diagnosis.evidence[0]?.items.map((item) => [
        item.description,
        item.doneCount,
        item.missing.map((ref) => ref.audienceName),
      ]),
    ).toEqual([
      ["漏水点的位置与照片", 1, ["李明", "王芳"]],
      ["和同伴核对过位置", 3, []],
    ]);
    expect(diagnosis.alerts.find((alert) => alert.kind === "evidence_gap")).toMatchObject({
      text: "「现场认定」的「漏水点的位置与照片」3 份中 2 份没勾选",
      action: { target: "page", query: "#evidence" },
    });
  });

  it("does not raise an evidence alert on fewer than three submissions", () => {
    const diagnosis = buildReleaseDiagnosis(
      release({
        submissions: [
          submission({ id: "c1", studentId: "s-chen" }),
          submission({ id: "l1", studentId: "s-li" }),
        ],
      }),
      NOW,
    );
    expect(diagnosis.evidence[0]?.items[0]?.missing).toHaveLength(2);
    expect(diagnosis.alerts.some((alert) => alert.kind === "evidence_gap")).toBe(false);
  });

  it("pairs each requested revision with the next evaluated one, per relevant dimension", () => {
    const diagnosis = buildReleaseDiagnosis(
      release({
        submissions: [
          submission({
            id: "c2",
            studentId: "s-chen",
            phaseIndex: 2,
            final: true,
            latestRevisionNumber: 2,
            revisions: [
              {
                revisionNumber: 1,
                nextStep: "REVISE",
                outcomes: outcomes("insufficient", "improve", "improve"),
              },
              {
                revisionNumber: 2,
                nextStep: "CONTINUE",
                outcomes: outcomes("insufficient", "pass", "improve"),
              },
            ],
          }),
          // Asked to revise, nothing back yet.
          submission({
            id: "w1",
            studentId: "s-wang",
            phaseIndex: 1,
            revisions: [{ revisionNumber: 1, nextStep: "REVISE", outcomes: null }],
          }),
        ],
      }),
      NOW,
    );

    expect(diagnosis.resubmission).toMatchObject({
      reviseCount: 2,
      resubmittedCount: 1,
      rose: 1,
      unchanged: 1,
      fell: 0,
    });
    expect(diagnosis.resubmission.awaiting).toEqual([
      { submissionId: "w1", audienceName: "王芳", phaseLabel: "现场认定" },
    ]);
    // 问题与机理 serves goal 1 only, so phase 2 never compares it (D-076).
    expect(diagnosis.resubmission.pairs).toEqual([
      {
        submissionId: "c2",
        audienceName: "陈同学",
        phaseLabel: null,
        moves: [
          { dimensionName: "数据与证据", before: "improve", after: "pass", movement: "rose" },
          {
            dimensionName: "跨学科连接",
            before: "improve",
            after: "improve",
            movement: "unchanged",
          },
        ],
      },
    ]);
    expect(
      diagnosis.alerts.find((alert) => alert.kind === "awaiting_resubmission"),
    ).toMatchObject({ text: "要求重交的 2 份里 1 份还没重交", basis: "王芳" });
  });

  it("takes each audience's most recently confirmed scaffold tier", () => {
    const none = buildReleaseDiagnosis(
      release({ submissions: [submission({ id: "c1", studentId: "s-chen" })] }),
      NOW,
    );
    expect(none.support).toBeNull();

    const diagnosis = buildReleaseDiagnosis(
      release({
        submissions: [
          submission({
            id: "c1",
            studentId: "s-chen",
            phaseIndex: 1,
            currentRevision: revision({
              supportLevel: "FOUNDATION",
              feedbackConfirmedAt: daysAgo(4),
            }),
          }),
          submission({
            id: "c2",
            studentId: "s-chen",
            phaseIndex: 2,
            final: true,
            currentRevision: revision({
              supportLevel: "STANDARD",
              feedbackConfirmedAt: daysAgo(1),
            }),
          }),
          submission({
            id: "l1",
            studentId: "s-li",
            currentRevision: revision({
              supportLevel: "CHALLENGE",
              feedbackConfirmedAt: daysAgo(2),
            }),
          }),
        ],
      }),
      NOW,
    );
    expect(
      diagnosis.support?.tiers.map((tier) => [
        tier.label,
        tier.audiences.map((audience) => [audience.name, audience.submissionId]),
      ]),
    ).toEqual([
      ["基础支持", []],
      ["标准任务", [["陈同学", "c2"]]],
      ["挑战拓展", [["李明", "l1"]]],
    ]);
  });
});
