import { describe, expect, it } from "vitest";
import { waterConservationActivity, waterConservationTaskBook } from "../../fixtures/water-conservation";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import { activityContentSchema, activityContentV2Schema, activityContentV3Schema } from "./activity-content";

describe("activityContentSchema", () => {
  it("accepts the canonical water conservation fixture", () => {
    expect(activityContentSchema.parse(waterConservationActivity)).toEqual(
      waterConservationActivity,
    );
  });

  it("rejects an activity without evidence requirements", () => {
    const result = activityContentSchema.safeParse({
      ...waterConservationActivity,
      evidenceRequirements: [],
    });

    expect(result.success).toBe(false);
  });

  it("trims content and rejects blank task instructions", () => {
    const result = activityContentSchema.safeParse({
      ...waterConservationActivity,
      taskInstructions: "   ",
    });

    expect(result.success).toBe(false);
  });

  it("requires the legacy task-book baseline for v2", () => {
    expect(activityContentV2Schema.parse(waterConservationTaskBook)).toMatchObject({
      schemaVersion: 2,
      integratedDisciplineCodes: ["math", "chinese"],
      phases: expect.any(Array),
      rubricDimensions: expect.any(Array),
    });
    expect(activityContentV2Schema.safeParse({
      ...waterConservationTaskBook,
      integratedDisciplineCodes: ["physics"],
    }).success).toBe(false);
    expect(activityContentV2Schema.safeParse({
      ...waterConservationTaskBook,
      assignmentType: "project",
      assignmentSubtype: "survey",
    }).success).toBe(false);
  });

  it("accepts v3 canonical goals and rejects invalid competency, coverage and evidence links", () => {
    expect(activityContentV3Schema.parse(waterConservationTaskBookV3)).toMatchObject({
      schemaVersion: 3,
      learningGoals: expect.any(Array),
      disciplineContributions: expect.any(Array),
    });
    expect(activityContentV3Schema.safeParse({
      ...waterConservationTaskBookV3,
      learningGoals: [{ ...waterConservationTaskBookV3.learningGoals[0]!, competencyReferences: [{ disciplineCode: "physics", competencyCode: "not_a_competency" }] }, ...waterConservationTaskBookV3.learningGoals.slice(1)],
    }).success).toBe(false);
    expect(activityContentV3Schema.safeParse({
      ...waterConservationTaskBookV3,
      phases: waterConservationTaskBookV3.phases.map((phase, index) => index === 0 ? { ...phase, learningGoalIds: ["missing-goal"] } : phase),
    }).success).toBe(false);
    expect(activityContentV3Schema.safeParse({
      ...waterConservationTaskBookV3,
      phases: waterConservationTaskBookV3.phases.map((phase, index) => index === 0 ? { ...phase, evidence: [{ type: "video", description: "视频" }] } : phase),
    }).success).toBe(false);
    expect(activityContentV3Schema.safeParse({
      ...waterConservationTaskBookV3,
      assignmentType: "project",
      assignmentSubtype: null,
      inquiryDepth: "basic",
    }).success).toBe(false);
  });
});
