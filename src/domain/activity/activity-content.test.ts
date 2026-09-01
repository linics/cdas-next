import { describe, expect, it } from "vitest";
import { waterConservationActivity, waterConservationTaskBook } from "../../fixtures/water-conservation";
import { waterConservationTaskBookV3 } from "../../fixtures/water-conservation-v3";
import {
  activityContentSchema,
  activityContentV2Schema,
  activityContentV3Schema,
} from "./activity-content";

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

  it("binds v3 competency references to the selected discipline, stage and grade", () => {
    expect(activityContentV3Schema.parse(waterConservationTaskBookV3)).toEqual(
      waterConservationTaskBookV3,
    );
    const withReference = (disciplineCode: string, competencyCode: string) => ({
      ...waterConservationTaskBookV3,
      learningGoals: waterConservationTaskBookV3.learningGoals.map((goal, index) =>
        index === 0
          ? {
              ...goal,
              competencyReferences: [{ disciplineCode, competencyCode }],
            }
          : goal,
      ),
    });

    expect(
      activityContentV3Schema.safeParse(
        withReference("physics", "not_a_registered_competency"),
      ).success,
    ).toBe(false);
    expect(
      activityContentV3Schema.safeParse(
        withReference("history", "historical_evidence"),
      ).success,
    ).toBe(false);
    expect(
      activityContentV3Schema.safeParse(
        withReference("infoTech", "computational_thinking"),
      ).success,
    ).toBe(false);
  });
});
