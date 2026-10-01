import { describe, expect, it } from "vitest";
import { waterConservationTaskBookV3 as content } from "../../fixtures/water-conservation-v3";
import type { ReleaseDiagnosis } from "./release-diagnosis";
import {
  buildTaskBookSignals,
  carryTaskBookSignals,
  taskBookFieldAt,
} from "./task-book-signals";

function ref(name: string) {
  return { submissionId: `s-${name}`, audienceName: name, phaseLabel: null };
}

function dimension(index: number, sampleCount: number, improve: number, insufficient: number, weak: boolean) {
  return {
    dimensionIndex: index,
    dimensionName: `维度 ${index}`,
    sampleCount,
    excellent: 0,
    good: sampleCount - improve - insufficient,
    pass: 0,
    improve,
    insufficient,
    weak,
    lowCount: improve + insufficient,
  };
}

const diagnosis: Pick<ReleaseDiagnosis, "evidence" | "matrix"> = {
  evidence: [
    {
      phaseIndex: 2,
      phaseName: "读数与估算",
      submittedCount: 4,
      items: [
        { evidenceIndex: 1, description: "读数表", typeLabel: "文档", doneCount: 4, missing: [] },
        {
          evidenceIndex: 2,
          description: "现场照片",
          typeLabel: "图片",
          doneCount: 1,
          missing: [ref("陈"), ref("李"), ref("王")],
        },
      ],
    },
    {
      // Two submissions are not enough to say anything about the task book.
      phaseIndex: 3,
      phaseName: "建议书",
      submittedCount: 2,
      items: [
        { evidenceIndex: 1, description: "定稿", typeLabel: "文字记录", doneCount: 0, missing: [ref("陈"), ref("李")] },
      ],
    },
  ],
  matrix: {
    status: "ready",
    sampleCount: 4,
    rows: [],
    dimensions: [dimension(1, 4, 0, 0, false), dimension(3, 4, 1, 2, true)],
  },
};

describe("task-book signals", () => {
  it("keeps only signals that point at how the task book is written", () => {
    const signals = buildTaskBookSignals(diagnosis, [
      {
        phaseIndex: 1,
        latest: {
          themes: [
            { kind: "STRENGTH", statement: "都写了位置", sources: [1, 2, 3] },
            { kind: "GAP", statement: "没有写判断依据", sources: [1, 2] },
          ],
        },
      },
      { phaseIndex: 0, latest: { themes: [{ kind: "GAP", statement: "建议没有对应数据", sources: [1, 2] }] } },
      { phaseIndex: 2, latest: null },
    ]);
    expect(signals).toEqual([
      {
        target: "phases.2.evidence.2",
        kind: "EVIDENCE_SKIPPED",
        text: "已交的 4 份里有 3 份没有勾选这项证据。",
      },
      {
        target: "rubricDimensions.3",
        kind: "DIMENSION_LOW",
        text: "4 份相关评价里有 3 份落在低档（需改进 1 份，证据不足 2 份）。",
      },
      {
        target: "phases.1",
        kind: "ANSWER_GAP",
        text: "AI 归纳的作答共同缺口（出自 2 份作答的原文）：没有写判断依据",
      },
      {
        target: "taskInstructions",
        kind: "ANSWER_GAP",
        text: "AI 归纳的作答共同缺口（出自 2 份作答的原文）：建议没有对应数据",
      },
    ]);
  });

  it("reads the field a target stands for, and nothing for unknown targets", () => {
    expect(taskBookFieldAt(content, "taskInstructions")).toBe(content.taskInstructions);
    expect(taskBookFieldAt(content, "phases.2.evidence.1")).toBe(
      JSON.stringify(content.phases[1]!.evidence[0]),
    );
    expect(taskBookFieldAt(content, "phases.9")).toBeNull();
    expect(taskBookFieldAt(content, "rubricDimensions.2.evidence.1")).toBeNull();
    expect(taskBookFieldAt(content, "learningGoals.1")).toBeNull();
  });

  it("says whether a copied draft still reads the way the release did", () => {
    const signal = (target: string) => ({
      target,
      kind: "EVIDENCE_SKIPPED" as const,
      text: "已交的 4 份里有 3 份没有勾选这项证据。",
      sourceLabel: target,
    });
    const edited = {
      ...content,
      phases: content.phases
        .slice(0, content.phases.length - 1)
        .map((phase, index) =>
          index === 1
            ? {
                ...phase,
                evidence: phase.evidence.map((item, evidenceIndex) =>
                  evidenceIndex === 0 ? { ...item, description: "两个点位的对比照片" } : item,
                ),
              }
            : phase,
        ),
    };
    const carried = carryTaskBookSignals(
      [
        signal("phases.1.evidence.1"),
        signal("phases.2.evidence.1"),
        signal(`phases.${content.phases.length}`),
      ],
      content,
      edited,
    );
    expect(carried.map((item) => item.state)).toEqual(["unchanged", "changed", "removed"]);
  });
});
